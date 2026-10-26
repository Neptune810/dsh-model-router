#!/usr/bin/env node
// Release gate for @neptune810/dsh-model-router.
//
// Checks, in order:
//   1. package.json is a valid manifest: semver version, repository, licence,
//      a dsh.bundle.patch file that exists, an exports["./client"] file that
//      exists, and the "files" whitelist.
//   2. The first "## x.y.z" heading of CHANGELOG.md equals the version.
//   3. The git tag (--tag, or GITHUB_REF/GITHUB_REF_NAME on a tag build) is
//      "v" + version (a bare "x.y.z" tag is accepted too).
//   4. With --pack: "npm pack --dry-run --json" ships every required file, no
//      test/, scripts/ or .github/ file, and nothing outside the "files"
//      whitelist.
//
// Exit code 0 when every check passes, 1 on the first failing group. When
// GITHUB_ACTIONS=true every failure is echoed as a "::error::" annotation too,
// because the raw Actions log of a public repository is not world readable.

import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** First release heading of a CHANGELOG, ignoring "Unreleased" sections. */
export function changelogVersion(text) {
  for (const line of String(text).split(/\r?\n/)) {
    const match = /^##\s+(.+?)\s*$/.exec(line)
    if (!match) continue
    const heading = match[1]
    if (/^unreleased\b/i.test(heading)) continue
    const version = /^(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(heading)
    if (version) return version[1]
  }
  return null
}

/** Read the tag a CI run is building, if any. */
export function tagFromEnv(env = process.env) {
  const ref = env.GITHUB_REF || ''
  if (ref.startsWith('refs/tags/')) return ref.slice('refs/tags/'.length)
  const name = env.GITHUB_REF_NAME || ''
  if (/^v?\d+\.\d+\.\d+/.test(name)) return name
  return null
}

/** Compare version, changelog heading and tag. Returns { ok, errors }. */
export function checkRelease({ version, changelogText, tag = null }) {
  const errors = []
  if (!version || !SEMVER.test(String(version))) errors.push('package.json version "' + version + '" is not semver')
  const logged = changelogVersion(changelogText)
  if (!logged) errors.push('CHANGELOG.md has no "## x.y.z" release heading')
  else if (version && logged !== version) errors.push('CHANGELOG.md starts at ' + logged + ' but package.json says ' + version)
  if (tag !== null) {
    const expected = 'v' + version
    if (tag !== expected && tag !== String(version)) errors.push('git tag "' + tag + '" does not match package.json version (expected ' + expected + ')')
  }
  return { ok: errors.length === 0, errors, version, changelogVersion: logged, tag }
}

/** Manifest integrity that must hold for every release. */
export function checkManifest(pkg, root = ROOT) {
  const errors = []
  if (!pkg || typeof pkg !== 'object') return ['package.json is not an object']
  if (!pkg.version || !SEMVER.test(String(pkg.version))) errors.push('version is not semver')
  if (typeof pkg.name !== 'string' || !pkg.name.startsWith('@')) errors.push('name must be a scoped package')
  if (!pkg.repository || !pkg.repository.url) errors.push('repository.url is required')
  if (pkg.license !== 'MIT') errors.push('license must be MIT')
  const patch = pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch
  if (!patch) errors.push('dsh.bundle.patch is required')
  else if (!existsSync(join(root, patch))) errors.push('dsh.bundle.patch points at a missing file: ' + patch)
  const client = pkg.exports && pkg.exports['./client']
  if (!client) errors.push('exports["./client"] is required')
  else if (!existsSync(join(root, client))) errors.push('exports["./client"] points at a missing file: ' + client)
  if (!Array.isArray(pkg.files) || pkg.files.length === 0) errors.push('files whitelist is required')
  if (!pkg.engines || typeof pkg.engines.node !== 'string') errors.push('engines.node is required')
  return errors
}

/** Verify the tarball contents produced by "npm pack --dry-run --json". */
export function checkPack(files) {
  const errors = []
  const required = [
    'package.json', 'lib/index.js', 'client/client.js', 'cordis.patch.yml',
    'README.md', 'README.zh.md', 'CHANGELOG.md', 'LICENSE', 'docs/ui-preview.html',
    'lib/catalog.js', 'catalog/model-catalog.yaml', 'schema/model-catalog.schema.json',
  ]
  const listed = new Set(files)
  for (const file of required) if (!listed.has(file)) errors.push('packed tarball is missing ' + file)
  for (const file of files) {
    if (file.startsWith('test/') || file.startsWith('scripts/') || file.startsWith('.github/')) errors.push('packed tarball must not ship ' + file)
  }
  return errors
}

export function packFiles(cwd = ROOT) {
  const out = execSync('npm pack --dry-run --json --ignore-scripts', { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  const parsed = JSON.parse(out)
  const entry = Array.isArray(parsed) ? parsed[0] : parsed
  return (entry.files || []).map((file) => file.path)
}

function annotate(errors) {
  if (process.env.GITHUB_ACTIONS !== 'true') return
  for (const error of errors) console.log('::error::' + String(error).replace(/\r?\n/g, ' ').slice(0, 900))
}

function main(argv) {
  const args = argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    console.log('usage: node scripts/check-release.mjs [--tag <tag>] [--package <path>] [--changelog <path>] [--pack] [--json]')
    return 0
  }
  const option = (name, fallback) => {
    const at = args.indexOf(name)
    return at >= 0 && args[at + 1] ? args[at + 1] : fallback
  }
  const packagePath = resolve(ROOT, option('--package', join(ROOT, 'package.json')))
  const changelogPath = resolve(ROOT, option('--changelog', join(ROOT, 'CHANGELOG.md')))
  const explicitTag = option('--tag', null)
  const tag = explicitTag !== null ? explicitTag : tagFromEnv()
  const wantJson = args.includes('--json')

  const errors = []
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8'))
  errors.push(...checkManifest(pkg, dirname(packagePath)))
  const changelogText = readFileSync(changelogPath, 'utf8')
  const result = checkRelease({ version: pkg.version, changelogText, tag })
  errors.push(...result.errors)
  let packed = null
  if (args.includes('--pack')) {
    try {
      packed = packFiles(dirname(packagePath))
      errors.push(...checkPack(packed))
    } catch (error) {
      errors.push('npm pack failed: ' + String((error && error.message) || error).split('\n')[0])
    }
  }

  const summary = { ok: errors.length === 0, version: pkg.version, changelogVersion: result.changelogVersion, tag, packedFiles: packed ? packed.length : null, errors }
  if (wantJson) console.log(JSON.stringify(summary))
  else {
    console.log('version=' + summary.version + ' changelog=' + summary.changelogVersion + ' tag=' + (tag === null ? '(none)' : tag))
    if (packed) console.log('packed files=' + packed.length)
    for (const error of errors) console.log('FAIL ' + error)
    if (summary.ok) console.log('release checks passed')
  }
  if (!summary.ok) annotate(errors)
  return summary.ok ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv)
}

export { main }
