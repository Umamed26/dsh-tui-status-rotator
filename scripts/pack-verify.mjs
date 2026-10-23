#!/usr/bin/env node
/**
 * Offline pack audit: prove the artifact npm would publish is the artifact the
 * TUI host installs. Uses `npm pack --dry-run --json` (no tarball is written,
 * no lifecycle scripts run) and asserts:
 *
 *  - the built host entry (lib/types/index.js + its .d.ts) is in the tarball;
 *  - dsh-plugin.json, cordis.patch.yml, README.md, README_ZH.md and LICENSE ship;
 *  - the manifest's facets.host.entry is covered by the packed file list;
 *  - test/, node_modules/, src/, scripts/ and dev config are NOT shipped;
 *  - the tarball filename / integrity metadata are present.
 *
 * Run: npm run build && node scripts/pack-verify.mjs
 * Exit: 0 pack shape is clean, 1 any violation (actionable message).
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const REQUIRED = [
  'package.json',
  'dsh-plugin.json',
  'cordis.patch.yml',
  'README.md',
  'README_ZH.md',
  'LICENSE',
  'lib/types/index.js',
  'lib/types/index.d.ts',
]
const REQUIRED_PREFIXES = ['lib/']
const FORBIDDEN_PREFIXES = ['test/', 'node_modules/', 'src/', 'scripts/', '.github/', '.git/']
const FORBIDDEN_FILES = ['package-lock.json', 'tsconfig.json', 'tsconfig.typecheck.json', '.gitignore', '.npmrc', 'dsh-plugin.json.bak']

const failures = []
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS' : 'FAIL') + ': ' + name + (ok || detail === undefined ? '' : ' — ' + detail))
  if (!ok) failures.push(name)
}

function runPack() {
  const output = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
  })
  const start = output.indexOf('[')
  if (start < 0) throw new Error('npm pack --dry-run --json did not return a JSON array: ' + output.slice(0, 400))
  const parsed = JSON.parse(output.slice(start))
  if (!Array.isArray(parsed) || parsed.length !== 1) throw new Error('npm pack returned ' + (Array.isArray(parsed) ? parsed.length : 'non-array') + ' pack entries (expected exactly 1)')
  return parsed[0]
}

console.log('pack verify: ' + root)
let pack
try {
  pack = runPack()
} catch (error) {
  console.error('FAIL: npm pack --dry-run --json failed — ' + (error instanceof Error ? error.message : String(error)))
  process.exit(1)
}

const files = Array.isArray(pack.files) ? pack.files.map(file => ({ path: String(file.path), size: Number(file.size) || 0 })) : []
const paths = new Set(files.map(file => file.path))
const byPath = new Map(files.map(file => [file.path, file]))

check('npm pack describes a files array', files.length > 0, 'no files in pack result')
check('pack filename matches <name>-<version>.tgz',
  typeof pack.filename === 'string' && pack.filename === String(pack.name) + '-' + String(pack.version) + '.tgz',
  String(pack.filename))
check('pack integrity metadata is present', typeof pack.integrity === 'string' && pack.integrity.length > 0, String(pack.integrity))
check('pack total size is non-zero', typeof pack.size === 'number' && pack.size > 0, String(pack.size))

// --- required files ---------------------------------------------------------
for (const required of REQUIRED) check('packaged file: ' + required, paths.has(required), 'missing from tarball')
for (const prefix of REQUIRED_PREFIXES) {
  check('packaged directory: ' + prefix, files.some(file => file.path.startsWith(prefix)),
    'no packaged file starts with ' + prefix + ' (run "npm run build" first)')
}

// --- manifest <-> tarball coupling -----------------------------------------
const manifestPath = join(root, 'dsh-plugin.json')
let manifest
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
} catch (error) {
  console.error('FAIL: cannot read dsh-plugin.json — ' + (error instanceof Error ? error.message : String(error)))
  process.exit(1)
}
const entry = manifest?.facets?.host?.entry
check('manifest declares facets.host.entry', typeof entry === 'string' && entry.length > 0, String(entry))
if (typeof entry === 'string') {
  check('facets.host.entry is packaged (' + entry + ')', paths.has(entry), 'host entry is not in the tarball')
  const dts = entry.replace(/\.js$/u, '.d.ts')
  check('declaration next to the host entry is packaged (' + dts + ')', paths.has(dts), dts + ' is not in the tarball')
  check('built host entry exists on disk before packing', existsSync(join(root, entry)), 'run "npm run build" first')
}

// --- leak checks ------------------------------------------------------------
for (const prefix of FORBIDDEN_PREFIXES) {
  const leaked = files.filter(file => file.path.startsWith(prefix)).map(file => file.path)
  check('tarball does not ship ' + prefix, leaked.length === 0, leaked.slice(0, 5).join(', '))
}
for (const file of FORBIDDEN_FILES) {
  check('tarball does not ship ' + file, !paths.has(file))
}
const testsLeaked = files.filter(file => /(^|\/)(test|tests|spec)\//u.test(file.path) || /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(file.path))
check('tarball ships no test files', testsLeaked.length === 0, testsLeaked.slice(0, 5).map(file => file.path).join(', '))
const mapsLeaked = files.filter(file => file.path.endsWith('.map'))
check('tarball ships no source maps (declarationMap/sourceMap are off)', mapsLeaked.length === 0, mapsLeaked.slice(0, 5).map(file => file.path).join(', '))

// --- print the packed file list --------------------------------------------
const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path))
const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
console.log('')
console.log('== packed files (' + files.length + ', ' + (totalBytes / 1024).toFixed(1) + ' KiB unpacked) ==')
for (const file of sorted) console.log('  ' + String(file.size).padStart(8) + '  ' + file.path)
const top = [...files].sort((a, b) => b.size - a.size).slice(0, 5)
console.log('largest: ' + top.map(file => file.path + ' (' + (file.size / 1024).toFixed(1) + ' KiB)').join(', '))

console.log('')
if (failures.length > 0) {
  console.error('FAIL: ' + failures.length + ' pack check(s) failed: ' + failures.join('; '))
  process.exitCode = 1
} else {
  console.log('PASS: packed artifact contains the host entry, manifest, patch, docs and license; no tests/node_modules/src/scripts leak')
}
