#!/usr/bin/env python3
"""dsh-model-router — build lib/catalog.js from catalog/model-catalog.yaml.

The YAML is the human-edited source of truth (prices, effort vocabularies,
channels, evidence date). This script turns it into a single deterministic ESM
module so the runtime and the tests never need a YAML parser or a dependency.

Determinism rules (a --check run must be byte-identical on Windows, macOS, Ubuntu):
  * JSON keys sorted recursively (json.dumps sort_keys=True)
  * two-space indent, no trailing spaces
  * LF line endings only (open(..., newline="\n"))
  * UTF-8 without BOM, non-ASCII kept as-is (the catalog carries Chinese notes)
  * exactly one trailing newline
  * the JS wrapper below is a fixed literal, not derived from the YAML

Usage:
  python scripts/build-catalog.py            # write lib/catalog.js
  python scripts/build-catalog.py --check     # exit 0 iff the committed file is up to date
  python scripts/build-catalog.py --print     # dump the generated module to stdout

Exit codes: 0 ok, 1 stale/unreadable generated file, 2 bad input (YAML/PyYAML/schema).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True

REPO_ROOT = Path(__file__).resolve().parent.parent
SOURCE_YAML = REPO_ROOT / "catalog" / "model-catalog.yaml"
OUTPUT_JS = REPO_ROOT / "lib" / "catalog.js"

HEADER = """/**
 * GENERATED FILE - DO NOT EDIT.
 *
 * Source:      catalog/model-catalog.yaml
 * Regenerate:  python scripts/build-catalog.py
 * Verify:      python scripts/build-catalog.py --check
 *
 * The YAML is the source of truth (prices, effort vocabularies, channels,
 * evidence date); this module is the dependency-free projection the runtime and
 * the tests import. Keys are sorted, the indentation is two spaces and the line
 * endings are LF, so regenerating it on another machine changes nothing.
 *
 * Exports: CATALOG (whole document), MODELS (frozen model list),
 * findModel(provider, id) - lookup by canonical id, channel-qualified id or
 * OpenRouter id.
 */

"""

FOOTER = """
/** Every model entry, frozen, in catalog order. */
export const MODELS = Object.freeze(CATALOG.models)

/**
 * Look one model up.
 *
 * The first argument is a provider or a channel name: the canonical provider
 * ("deepseek"), an official channel ("deepseek-official"), an account-pool
 * channel ("deepseek-account"), a relay ("qiyue", "qy", "sub2") or
 * "openrouter". The second argument is a model id - either the catalog id
 * ("deepseek-flash") or a channel-qualified / OpenRouter id
 * ("deepseek/deepseek-v4.1-flash-1017").
 *
 * When the provider is omitted (or unknown) the id alone is matched, which is
 * what the panel does when the user typed just a model name.
 *
 * @param {string | null | undefined} provider
 * @param {string | null | undefined} id
 * @returns {object | undefined} the matching model entry
 */
export function findModel(provider, id) {
  // findModel(id) is the common case; treat a lone argument as the id.
  if (id === undefined) {
    id = provider
    provider = undefined
  }
  const wantProvider = normalizeKey(provider)
  const wantId = normalizeKey(id)
  if (wantId.length === 0) return undefined

  const channelNames = (model) => {
    const channels = model.channels || {}
    const names = []
    const official = channels.official || {}
    if (typeof official.channel === 'string' && official.channel.length > 0) names.push(official.channel)
    if (typeof channels.openrouterId === 'string' && channels.openrouterId.length > 0) names.push('openrouter')
    for (const entry of channels.accountPool || []) {
      if (entry && typeof entry.channel === 'string' && entry.channel.length > 0) names.push(entry.channel)
    }
    for (const entry of channels.relay || []) {
      if (entry && typeof entry.channel === 'string' && entry.channel.length > 0) names.push(entry.channel)
    }
    return names
  }

  const idMatches = (model) => {
    const channels = model.channels || {}
    const official = channels.official || {}
    if (normalizeKey(model.id) === wantId) return true
    if (normalizeKey(official.modelId) === wantId) return true
    if (normalizeKey(channels.openrouterId) === wantId) return true
    // Channel-qualified ids ("qiyue/deepseek-flash") address a specific resale
    // route, so match those too - otherwise a relay id looks unknown.
    for (const entry of [...(channels.accountPool || []), ...(channels.relay || [])]) {
      if (!entry) continue
      if (normalizeKey(entry.qualifiedId) === wantId) return true
      if (normalizeKey(entry.channel + '/' + entry.modelId) === wantId) return true
    }
    return false
  }

  const candidates = CATALOG.models.filter(idMatches)
  if (candidates.length === 0) return undefined
  if (wantProvider.length === 0) return candidates[0]

  for (const model of candidates) {
    const names = channelNames(model).map(normalizeKey)
    // The bare provider is a valid address too ("deepseek" == any deepseek entry).
    if (names.includes(wantProvider) || normalizeKey(model.provider) === wantProvider) return model
  }
  // A model exists under that id but not under the requested channel: return it
  // anyway so callers can fall back to the canonical entry instead of crashing.
  return candidates[0]
}

/** Lowercase, trim, and treat null/undefined as the empty string. */
function normalizeKey(value) {
  return String(value === undefined || value === null ? '' : value)
    .trim()
    .toLowerCase()
}
"""


def fail(message: str) -> "NoReturn":  # type: ignore[name-defined]
    print(safe("build-catalog: " + message), file=sys.stderr)
    raise SystemExit(2)


def safe(text: str) -> str:
    """Print-safe text: never let a Windows cp1252 console kill the run."""
    encoding = sys.stdout.encoding or "utf-8"
    try:
        text.encode(encoding)
        return text
    except (UnicodeEncodeError, LookupError):
        return text.encode(encoding, "backslashreplace").decode(encoding, "replace")


def load_catalog(path: Path) -> dict:
    try:
        import yaml  # noqa: PLC0415 - optional dependency, reported below
    except ImportError:
        fail(
            "PyYAML is required (no npm dependency is added for this). "
            "Install it with: pip install pyyaml  /  python -m pip install pyyaml  /  python3 -m pip install pyyaml"
        )
    if not path.is_file():
        fail("missing source YAML: " + str(path))
    try:
        catalog = yaml.safe_load(path.read_text(encoding="utf-8"))
    except Exception as error:  # noqa: BLE001 - surfacing the parser message is the point
        fail("YAML parse error in " + str(path) + ": " + str(error))
    if not isinstance(catalog, dict):
        fail("source YAML did not parse into a mapping")
    return catalog


def check_catalog(catalog: dict) -> None:
    """The minimum this generator needs; the full contract lives in the JSON Schema."""
    required = ["schemaVersion", "generatedAt", "evidenceDate", "fxRate", "aaVersion", "modelCount", "channels", "models"]
    for key in required:
        if key not in catalog:
            fail("catalog is missing top-level key '" + key + "'")
    models = catalog["models"]
    if not isinstance(models, list) or not models:
        fail("catalog.models must be a non-empty list")
    if catalog["modelCount"] != len(models):
        fail("modelCount=" + str(catalog["modelCount"]) + " but models has " + str(len(models)) + " entries")
    seen: set[str] = set()
    for model in models:
        for key in ("id", "provider", "display", "contextWindow", "pricing", "effort", "channels", "sources"):
            if key not in model:
                fail("model '" + str(model.get("id", "?")) + "' is missing required key '" + key + "'")
        model_id = model["id"]
        if model_id in seen:
            fail("duplicate model id '" + model_id + "'")
        seen.add(model_id)
        pricing = model["pricing"]
        for key in ("currency", "unit", "input", "output", "effectiveFrom"):
            if key not in pricing:
                fail("model '" + model_id + "' pricing is missing '" + key + "'")
        if pricing["unit"] != "per_1m_tokens":
            fail("model '" + model_id + "' pricing.unit must be 'per_1m_tokens', got " + repr(pricing["unit"]))


def render(catalog: dict) -> str:
    body = json.dumps(catalog, indent=2, sort_keys=True, ensure_ascii=False)
    return HEADER + "export const CATALOG = " + body + "\n" + FOOTER


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Build lib/catalog.js from catalog/model-catalog.yaml")
    parser.add_argument("--check", action="store_true", help="verify lib/catalog.js is up to date (no writes)")
    parser.add_argument("--print", dest="dump", action="store_true", help="write the generated module to stdout")
    parser.add_argument("--source", default=str(SOURCE_YAML), help="alternate YAML source")
    parser.add_argument("--output", default=str(OUTPUT_JS), help="alternate output path")
    args = parser.parse_args(argv)

    source = Path(args.source)
    output = Path(args.output)
    catalog = load_catalog(source)
    check_catalog(catalog)
    expected = render(catalog)
    payload = expected.encode("utf-8")
    digest = hashlib.sha256(payload).hexdigest()
    summary = str(len(catalog["models"])) + " models, " + str(len(payload)) + " bytes, sha256 " + digest[:16]

    if args.dump:
        sys.stdout.buffer.write(payload)
        sys.stdout.buffer.flush()
        return 0

    if args.check:
        if not output.is_file():
            print(safe("check: FAIL " + str(output) + " does not exist"))
            return 1
        actual = output.read_bytes()
        if actual == payload:
            print(safe("check: OK " + str(output.relative_to(REPO_ROOT)) + " matches " + str(source.relative_to(REPO_ROOT)) + " (" + summary + ")"))
            return 0
        print(safe("check: FAIL " + str(output.relative_to(REPO_ROOT)) + " is stale; run: python scripts/build-catalog.py"))
        expected_lines = expected.split("\n")
        actual_lines = actual.decode("utf-8", "replace").split("\n")
        for index in range(max(len(expected_lines), len(actual_lines))):
            want = expected_lines[index] if index < len(expected_lines) else "<missing line>"
            have = actual_lines[index] if index < len(actual_lines) else "<missing line>"
            if want != have:
                print(safe("  first difference at line " + str(index + 1)))
                print(safe("    expected: " + want[:200]))
                print(safe("    actual:   " + have[:200]))
                break
        return 1

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(payload)
    print(safe("build: wrote " + str(output.relative_to(REPO_ROOT)) + " (" + summary + ")"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
