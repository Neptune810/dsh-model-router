import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  changelogVersion,
  checkManifest,
  checkPack,
  checkRelease,
  tagFromEnv,
} from '../scripts/check-release.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SCRIPT = join(ROOT, 'scripts', 'check-release.mjs')

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'model-router-release-'))
}

function writeFixture(dir, { version = '1.2.3', changelog = '## 1.2.3\n', repo = 'https://example.invalid/x' } = {}) {
  mkdirSync(join(dir, 'client'), { recursive: true })
  writeFileSync(join(dir, 'cordis.patch.yml'), 'plugins: {}\n', 'utf8')
  writeFileSync(join(dir, 'client', 'client.js'), 'window.__ModuleLoader__.load({})\n', 'utf8')
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: '@neptune810/dsh-model-router',
    version,
    license: 'MIT',
    repository: { type: 'git', url: repo },
    dsh: { bundle: { patch: './cordis.patch.yml' } },
    exports: { './client': './client/client.js' },
    files: ['lib/'],
    engines: { node: '>=20' },
  }, null, 2), 'utf8')
  writeFileSync(join(dir, 'CHANGELOG.md'), changelog, 'utf8')
}

function runCli(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })
}

test('changelogVersion reads the first release heading and skips Unreleased', () => {
  assert.equal(changelogVersion('# Changelog\n\n## Unreleased\n\n- later\n\n## 1.2.3\n\n- shipped\n'), '1.2.3')
  assert.equal(changelogVersion('# Changelog\n\n## 0.14.3-rc.2\n'), '0.14.3-rc.2')
  assert.equal(changelogVersion('# Changelog\n\n## Unreleased\n'), null)
  assert.equal(changelogVersion(''), null)
})

test('tagFromEnv only reports a tag ref, never a branch or PR ref', () => {
  assert.equal(tagFromEnv({ GITHUB_REF: 'refs/tags/v0.14.4' }), 'v0.14.4')
  assert.equal(tagFromEnv({ GITHUB_REF_NAME: 'v0.14.4' }), 'v0.14.4')
  assert.equal(tagFromEnv({ GITHUB_REF: 'refs/heads/main', GITHUB_REF_NAME: 'main' }), null)
  assert.equal(tagFromEnv({ GITHUB_REF: 'refs/pull/7/merge', GITHUB_REF_NAME: '7/merge' }), null)
  assert.equal(tagFromEnv({}), null)
})

test('checkRelease matches version, changelog and tag', () => {
  const ok = checkRelease({ version: '0.14.4', changelogText: '## 0.14.4\n', tag: 'v0.14.4' })
  assert.deepEqual(ok, { ok: true, errors: [], version: '0.14.4', changelogVersion: '0.14.4', tag: 'v0.14.4' })
  assert.equal(checkRelease({ version: '0.14.4', changelogText: '## 0.14.4\n', tag: '0.14.4' }).ok, true, 'a bare version tag is accepted')
  assert.match(checkRelease({ version: '0.14.4', changelogText: '## 0.14.3\n' }).errors[0], /CHANGELOG\.md starts at 0\.14\.3/)
  assert.match(checkRelease({ version: '0.14.4', changelogText: '## 0.14.4\n', tag: 'v0.14.5' }).errors[0], /does not match/)
  assert.match(checkRelease({ version: 'not-a-version', changelogText: '## 0.14.4\n' }).errors[0], /not semver/)
})

test('checkManifest accepts this repository and rejects a broken one', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  assert.deepEqual(checkManifest(pkg, ROOT), [])
  const broken = { name: 'unscoped', version: 'x', license: 'WTFPL', files: [] }
  const errors = checkManifest(broken, ROOT)
  assert.ok(errors.length >= 4, 'several manifest fields are reported: ' + errors.join('; '))
  assert.ok(errors.some((error) => error.includes('repository.url')))
  assert.ok(errors.some((error) => error.includes('dsh.bundle.patch')))
})

test('checkPack requires the shipped files and forbids test sources', () => {
  const good = [
    'package.json', 'lib/index.js', 'client/client.js', 'cordis.patch.yml', 'README.md',
    'README.zh.md', 'CHANGELOG.md', 'LICENSE', 'docs/ui-preview.html', 'lib/catalog.js',
    'catalog/model-catalog.yaml', 'schema/model-catalog.schema.json',
  ]
  assert.deepEqual(checkPack(good), [])
  assert.ok(checkPack(good.filter((file) => file !== 'lib/catalog.js')).some((error) => error.includes('lib/catalog.js')))
  assert.ok(checkPack([...good, 'test/release.test.js']).some((error) => error.includes('must not ship')))
})

test('the repository itself passes the release gate for its own version', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const changelogText = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8')
  const result = checkRelease({ version: pkg.version, changelogText, tag: 'v' + pkg.version })
  assert.deepEqual(result.errors, [], 'package.json and CHANGELOG.md must agree before a release')
})

test('CLI passes on a consistent fixture and fails on a mismatched tag', () => {
  const dir = tempDir()
  try {
    writeFixture(dir)
    const ok = runCli(['--package', join(dir, 'package.json'), '--changelog', join(dir, 'CHANGELOG.md'), '--tag', 'v1.2.3'])
    assert.equal(ok.status, 0, ok.stdout + ok.stderr)
    assert.match(ok.stdout, /release checks passed/)
    const bad = runCli(['--package', join(dir, 'package.json'), '--changelog', join(dir, 'CHANGELOG.md'), '--tag', 'v9.9.9'])
    assert.equal(bad.status, 1)
    assert.match(bad.stdout, /FAIL git tag/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CLI --json reports the summary for tooling', () => {
  const dir = tempDir()
  try {
    writeFixture(dir, { version: '2.0.0', changelog: '## Unreleased\n\n## 2.0.0\n' })
    const run = runCli(['--package', join(dir, 'package.json'), '--changelog', join(dir, 'CHANGELOG.md'), '--tag', 'v2.0.0', '--json'])
    assert.equal(run.status, 0, run.stdout + run.stderr)
    const summary = JSON.parse(run.stdout.trim())
    assert.deepEqual(
      { ok: summary.ok, version: summary.version, changelogVersion: summary.changelogVersion, tag: summary.tag },
      { ok: true, version: '2.0.0', changelogVersion: '2.0.0', tag: 'v2.0.0' },
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
