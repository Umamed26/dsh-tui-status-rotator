#!/usr/bin/env node
/**
 * Offline manifest guard for dsh-tui-status-rotator.
 *
 * The authoritative parser is @dsh-std/manifest Community v0.15 (fixed revision,
 * used by the TUI host). This script is the dependency-free subset that pins the
 * field shapes, the TUI Admission v0.15 policy rules (TUI-PKG-001/002) and the
 * package <-> manifest coupling, so the check runs in a fresh clone and in CI
 * without network access.
 *
 * It is a pre-check, not a replacement: a manifest that passes here still has to
 * pass the real parser + host negotiation before it can claim admission. The
 * committed evidence for that higher level lives in docs/verification.md.
 *
 * Run: node scripts/check-manifest.mjs [path-to-dsh-plugin.json]
 * Exit: 0 all checks pass, 1 at least one failure (actionable messages).
 */
import { readFileSync, existsSync, statSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifestFile = process.argv[2] ?? join(root, 'dsh-plugin.json')
const isProjectManifest = manifestFile === join(root, 'dsh-plugin.json')

// --- shapes fixed by the Community v0.15 schema (dsh-plugin-0.15.schema.json) ---
const NAMESPACED_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9][a-z0-9-]*)+$/u
const API_VERSION = /^[a-z][a-z0-9.-]*\/v[1-9][0-9]*(?:(?:alpha|beta)[1-9][0-9]*)?$/u
const FACET_VERSION = /^v[1-9][0-9]*(?:(?:alpha|beta)[1-9][0-9]*)?$/u
const KIND = /^[A-Z][A-Za-z0-9]*$/u
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u
const SCHEMA_URL = 'https://dsh.community/schemas/dsh-plugin-0.15.json'
const MANIFEST_VERSION = '0.15'
const FACET_API_VERSION = 'v1alpha1'

const REQUIRED_TOP_LEVEL = [
  '$schema', 'manifestVersion', 'id', 'name', 'version',
  'facets', 'requires', 'permissions', 'contributes', 'subscriptions',
]
const OPTIONAL_TOP_LEVEL = ['license', 'source', 'artifact', 'compat', 'overrides']
const CONTRACT_KEYS = ['apiVersion', 'kind', 'optional', 'fallback']
const PERMISSION_KEYS = ['name', 'scope', 'reason']
const COMMAND_KEYS = ['id', 'title', 'description']
const SUBSCRIPTION_KEYS = ['apiVersion', 'kind', 'scope']

// --- coordinates admitted by TUI Profile v0.15 (registry/registry-0.15.json) ---
// Kept inline on purpose: offline check, no dependency on the host checkout.
const ADMITTED_CONTRACTS = new Map([
  ['commands.dsh/v1alpha1#Command', 'import'],
  ['storage.dsh/v1alpha1#LocalStorage', 'import'],
  ['messages.dsh/v1alpha1#MessageObserver', 'import (event)'],
  ['presentation.dsh/v1alpha1#OpenExternal', 'import'],
  ['presentation.dsh/v1alpha1#UserInteraction', 'import'],
  ['presentation.dsh/v1alpha1#ExternalRedirect', 'import'],
  ['workspace.dsh/v1alpha1#WorkspaceProvider', 'extension'],
  ['tui.dsh/v1alpha1#DecisionEvents', 'definition (capability)'],
  ['tui.dsh/v1alpha1#Channel', 'definition (capability)'],
  ['tui.dsh/v1alpha1#SettingsSection', 'extension'],
  ['tui.dsh/v1alpha1#Scene', 'extension'],
  ['tui.dsh/v1alpha1#Backend', 'extension'],
])
// --- permissions admitted by the v0.15 permission registry ---
const ADMITTED_PERMISSIONS = new Set([
  'storage.local.read', 'storage.local.write', 'commands.invoke',
  'messages.observe.read', 'session.input.intercept', 'session.rewind.intercept',
  'session.switch.intercept', 'session.compact.intercept',
])

const failures = []
const warnings = []
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS' : 'FAIL') + ': ' + name + (ok || detail === undefined ? '' : ' — ' + detail))
  if (!ok) failures.push(name)
}
const warn = (name, detail) => {
  console.log('WARN: ' + name + (detail === undefined ? '' : ' — ' + detail))
  warnings.push(name)
}
const isObject = value => typeof value === 'object' && value !== null && !Array.isArray(value)
const isText = value => typeof value === 'string' && value.trim() !== ''
const sameShapeKeys = (value, allowed) => Object.keys(value).every(key => allowed.includes(key) || key.startsWith('x-'))
const badKeys = (value, allowed) => Object.keys(value).filter(key => !allowed.includes(key) && !key.startsWith('x-'))

function readJson(file, label) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    console.error('FAIL: ' + label + ' is not readable JSON — ' + error.message)
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------
console.log('manifest: ' + manifestFile)
const manifest = readJson(manifestFile, 'dsh-plugin.json')
const pkg = readJson(join(root, 'package.json'), 'package.json')
check('manifest is a JSON object', isObject(manifest))
if (!isObject(manifest)) {
  console.error('FAIL: ' + failures.length + ' check(s) failed')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// A. Package identity (TUI-PKG-001) + schema top level
// ---------------------------------------------------------------------------
check('required top-level keys are present: ' + REQUIRED_TOP_LEVEL.join(', '),
  REQUIRED_TOP_LEVEL.every(key => key in manifest),
  'missing: ' + REQUIRED_TOP_LEVEL.filter(key => !(key in manifest)).join(', '))
const unknownTop = badKeys(manifest, [...REQUIRED_TOP_LEVEL, ...OPTIONAL_TOP_LEVEL])
check('no unknown top-level keys (x-* escape hatch allowed)', unknownTop.length === 0, unknownTop.join(', '))

let schemaUrlOk = false
try {
  schemaUrlOk = isText(manifest.$schema) && new URL(manifest.$schema).protocol === 'https:'
} catch {
  schemaUrlOk = false
}
check('$schema is an absolute https URI', schemaUrlOk, String(manifest.$schema))
check('$schema pins the Community v0.15 schema', manifest.$schema === SCHEMA_URL,
  'expected ' + SCHEMA_URL + ', got ' + String(manifest.$schema))
check('manifestVersion is "0.15"', manifest.manifestVersion === MANIFEST_VERSION, String(manifest.manifestVersion))
check('id is a namespaced identifier', isText(manifest.id) && NAMESPACED_ID.test(manifest.id), String(manifest.id))
check('name is a non-empty string', isText(manifest.name), String(manifest.name))
check('version is semver', isText(manifest.version) && SEMVER.test(manifest.version), String(manifest.version))
if (isProjectManifest) {
  check('manifest version matches package.json version', manifest.version === pkg.version,
    String(manifest.version) + ' != ' + String(pkg.version))
  check('manifest name matches package.json name', manifest.name === pkg.name,
    String(manifest.name) + ' != ' + String(pkg.name))
}
check('license is declared on the manifest and package.json',
  isText(manifest.license) && manifest.license === pkg.license,
  'manifest=' + String(manifest.license) + ' package=' + String(pkg.license))
if (manifest.source === undefined) {
  warn('manifest.source.repository is not declared', 'TUI admission checklist A expects a locatable repository')
} else {
  check('source is an object with an absolute https repository URI',
    isObject(manifest.source) && isText(manifest.source.repository) && (() => {
      try { return new URL(manifest.source.repository).protocol === 'https:' } catch { return false }
    })(),
    isObject(manifest.source) ? String(manifest.source.repository) : String(manifest.source))
  check('source has no unknown keys', isObject(manifest.source) && badKeys(manifest.source, ['repository', 'revision']).length === 0,
    isObject(manifest.source) ? badKeys(manifest.source, ['repository', 'revision']).join(', ') : '')
}
check('manifest does not declare provides (services are injected, not provided by manifests)',
  manifest.provides === undefined)
check('manifest does not declare an unadmitted artifact row',
  manifest.artifact === undefined,
  'artifact digests are recorded in the admission claim, not in the working manifest')

// ---------------------------------------------------------------------------
// B. Facet: host entry must point at the built output
// ---------------------------------------------------------------------------
const facets = manifest.facets
check('facets is an object with only the "host" entry', isObject(facets) && Object.keys(facets).every(key => key === 'host'),
  isObject(facets) ? Object.keys(facets).join(', ') : String(facets))
const hostFacet = isObject(facets) ? facets.host : undefined
check('facets.host is an object', isObject(hostFacet))
const entry = isObject(hostFacet) ? hostFacet.entry : undefined
const entryIsRelativeJs = isText(entry)
  && !entry.startsWith('/') && !entry.startsWith('\\')
  && !entry.replaceAll('\\', '/').split('/').includes('..')
  && /\.(?:mjs|cjs|js)$/u.test(entry)
check('facets.host.entry is a package-relative .js entry file', entryIsRelativeJs, String(entry))
if (entryIsRelativeJs) {
  const entryFile = join(root, entry)
  const entryExists = existsSync(entryFile)
  check('facets.host.entry points at a built file (exists on disk)', entryExists,
    entryExists ? undefined : entry + ' is missing — run "npm run build" first (this check runs after build in "npm run verify")')
  if (entryIsRelativeJs) {
    const declaredMain = pkg.main
    if (declaredMain !== undefined && declaredMain !== entry) {
      warn('package.json main differs from facets.host.entry', String(declaredMain) + ' != ' + entry)
    }
    if (isProjectManifest && Array.isArray(pkg.files)) {
      const covered = pkg.files.some(pattern => {
        if (typeof pattern !== 'string') return false
        if (pattern === entry) return true
        const normalized = pattern.replaceAll('\\', '/').replace(/\/$/u, '')
        return normalized !== '' && !normalized.startsWith('!') && entry.startsWith(normalized + '/')
      })
      check('package.json files whitelist ships facets.host.entry', covered,
        covered ? undefined : entry + ' is not covered by package.json files ' + JSON.stringify(pkg.files))
    }
  }
}
check('facets.host.apiVersion is the admitted facet version "v1alpha1"',
  isObject(hostFacet) && hostFacet.apiVersion === FACET_API_VERSION, isObject(hostFacet) ? String(hostFacet.apiVersion) : '')
check('facets.host has no unknown keys',
  isObject(hostFacet) && badKeys(hostFacet, ['entry', 'apiVersion']).length === 0,
  isObject(hostFacet) ? badKeys(hostFacet, ['entry', 'apiVersion']).join(', ') : '')
check('facets does not declare client/worker facets (TUI admission: host facet only)',
  isObject(facets) && Object.keys(facets).length === 1)

// ---------------------------------------------------------------------------
// C. requires.contracts (TUI-PKG-002 declaration closure)
// ---------------------------------------------------------------------------
const requires = manifest.requires
check('requires is an object', isObject(requires))
check('requires.contracts is an array', isObject(requires) && Array.isArray(requires.contracts))
check('requires.services is absent or empty (no host service dependencies declared in manifests)',
  !isObject(requires) || requires.services === undefined
  || (Array.isArray(requires.services) && requires.services.length === 0))
if (isObject(requires) && Array.isArray(requires.contracts)) {
  const seen = new Set()
  let contractsOk = true
  for (const [index, contract] of requires.contracts.entries()) {
    const where = 'requires.contracts[' + index + ']'
    if (!isObject(contract)) { check(where + ' is an object', false, String(contract)); contractsOk = false; continue }
    const shapeOk = isText(contract.apiVersion) && API_VERSION.test(contract.apiVersion)
      && isText(contract.kind) && KIND.test(contract.kind)
      && (contract.optional === undefined || typeof contract.optional === 'boolean')
      && (contract.fallback === undefined || isText(contract.fallback))
      && badKeys(contract, CONTRACT_KEYS).length === 0
    if (!shapeOk) {
      check(where + ' has the v0.15 contract shape { apiVersion, kind, optional?, fallback? }', false, JSON.stringify(contract))
      contractsOk = false
      continue
    }
    const coordinate = contract.apiVersion + '#' + contract.kind
    if (ADMITTED_CONTRACTS.has(coordinate) === false) {
      check(where + ' coordinate is admitted by TUI Profile v0.15', false, coordinate + ' is not in registry-0.15.json imports/extensions')
      contractsOk = false
    }
    if (contract.optional === true && !isText(contract.fallback)) {
      check(where + ' optional requirement states a TUI-displayable fallback', false, coordinate + ' is optional but declares no fallback')
      contractsOk = false
    }
    if (contract.optional !== true && contract.fallback !== undefined) {
      warn(where + ' declares a fallback on a required contract', coordinate + ': fallback is only meaningful with optional: true')
    }
    if (seen.has(coordinate)) {
      check(where + ' is not a duplicate required contract', false, coordinate)
      contractsOk = false
    }
    seen.add(coordinate)
  }
  check('every required contract has the v0.15 contract shape', contractsOk)
  check('every required contract coordinate is admitted by TUI Profile v0.15',
    [...seen].every(coordinate => ADMITTED_CONTRACTS.has(coordinate)),
    [...seen].filter(coordinate => !ADMITTED_CONTRACTS.has(coordinate)).join(', '))
}

// ---------------------------------------------------------------------------
// D. permissions
// ---------------------------------------------------------------------------
const permissions = manifest.permissions
check('permissions is an array', Array.isArray(permissions))
if (Array.isArray(permissions)) {
  const seen = new Set()
  const commandIds = new Set(
    (isObject(manifest.contributes) && Array.isArray(manifest.contributes.commands) ? manifest.contributes.commands : [])
      .map(command => (isObject(command) ? command.id : undefined))
      .filter(id => typeof id === 'string'),
  )
  let permissionsOk = true
  for (const [index, permission] of permissions.entries()) {
    const where = 'permissions[' + index + ']'
    if (!isObject(permission)) { check(where + ' is an object', false, String(permission)); permissionsOk = false; continue }
    const shapeOk = isText(permission.name) && NAMESPACED_ID.test(permission.name)
      && isText(permission.scope)
      && badKeys(permission, PERMISSION_KEYS).length === 0
    if (!shapeOk) {
      check(where + ' has the v0.15 permission shape { name, scope, reason? } (reason required by project policy)', false, JSON.stringify(permission))
      permissionsOk = false
      continue
    }
    if (!ADMITTED_PERMISSIONS.has(permission.name)) {
      check(where + ' permission name is admitted by permissions-0.1.json', false, permission.name)
      permissionsOk = false
    }
    if (!isText(permission.reason)) {
      check(where + ' states a user-facing reason', false, permission.name + ' for ' + permission.scope)
      permissionsOk = false
    }
    const key = permission.name + '\0' + permission.scope
    if (seen.has(key)) { check(where + ' is not a duplicate permission row', false, key); permissionsOk = false }
    seen.add(key)
    if (permission.name === 'commands.invoke' && !commandIds.has(permission.scope)) {
      check(where + ' commands.invoke scope names a declared command id', false, permission.scope + ' is not in contributes.commands ids')
      permissionsOk = false
    }
  }
  check('every permission row has the v0.15 permission shape and a reason', permissionsOk)
  check('permission names are admitted by the v0.15 permission registry',
    permissions.every(permission => isObject(permission) && ADMITTED_PERMISSIONS.has(permission.name)),
    permissions.filter(permission => isObject(permission) && !ADMITTED_PERMISSIONS.has(permission.name)).map(permission => permission.name).join(', '))
}

// ---------------------------------------------------------------------------
// E. contributes (commands are the only contribution this facet ships)
// ---------------------------------------------------------------------------
const contributes = manifest.contributes
check('contributes is an object', isObject(contributes))
check('contributes.commands is a non-empty array', isObject(contributes) && Array.isArray(contributes.commands) && contributes.commands.length > 0,
  isObject(contributes) ? JSON.stringify(contributes.commands) : '')
check('contributes declares no panels (this facet contributes a command + runtime seams only)',
  !isObject(contributes) || contributes.panels === undefined || (Array.isArray(contributes.panels) && contributes.panels.length === 0))
check('contributes has no unknown contribution points outside commands/panels/x-*',
  !isObject(contributes) || badKeys(contributes, ['commands', 'panels']).length === 0,
  isObject(contributes) ? badKeys(contributes, ['commands', 'panels']).join(', ') : '')
if (isObject(contributes) && Array.isArray(contributes.commands)) {
  const ids = new Set()
  let commandsOk = true
  for (const [index, command] of contributes.commands.entries()) {
    const where = 'contributes.commands[' + index + ']'
    if (!isObject(command)) { check(where + ' is an object', false, String(command)); commandsOk = false; continue }
    const shapeOk = isText(command.id) && NAMESPACED_ID.test(command.id)
      && isText(command.title)
      && (command.description === undefined || isText(command.description))
      && badKeys(command, COMMAND_KEYS).length === 0
    if (!shapeOk) {
      check(where + ' has the v0.15 command shape { id, title, description? }', false, JSON.stringify(command))
      commandsOk = false
      continue
    }
    if (ids.has(command.id)) { check(where + ' command id is unique', false, command.id); commandsOk = false }
    ids.add(command.id)
    if (isText(manifest.id) && !command.id.startsWith(manifest.id + '.')) {
      warn(where + ' command id is not namespaced under the plugin id', command.id + ' (expected prefix ' + manifest.id + '.)')
    }
  }
  check('every contributed command item has the v0.15 command shape', commandsOk)
  check('command id has no duplicates', ids.size === contributes.commands.length)
  if (isProjectManifest) {
    const first = [...ids][0]
    check('project contributes exactly one command, namespaced under the plugin id',
      ids.size === 1 && typeof first === 'string' && first.startsWith(manifest.id + '.'),
      [...ids].join(', '))
    const titles = contributes.commands.map(command => (isObject(command) ? command.title : undefined))
    check('the contributed command is the /status-rotator slash command',
      titles.length === 1 && /^\/status-rotator$/u.test(String(titles[0])),
      JSON.stringify(titles))
  }
}

// ---------------------------------------------------------------------------
// F. subscriptions
// ---------------------------------------------------------------------------
const subscriptions = manifest.subscriptions
check('subscriptions is an array (may be empty)', Array.isArray(subscriptions))
if (Array.isArray(subscriptions)) {
  let subscriptionsOk = true
  for (const [index, subscription] of subscriptions.entries()) {
    const where = 'subscriptions[' + index + ']'
    if (typeof subscription === 'string') {
      if (!isText(subscription)) { check(where + ' is a non-empty string', false, JSON.stringify(subscription)); subscriptionsOk = false }
      continue
    }
    if (!isObject(subscription)) { check(where + ' is a string or subscription object', false, JSON.stringify(subscription)); subscriptionsOk = false; continue }
    const shapeOk = isText(subscription.apiVersion) && API_VERSION.test(subscription.apiVersion)
      && isText(subscription.kind) && KIND.test(subscription.kind)
      && (subscription.scope === undefined || isText(subscription.scope))
      && badKeys(subscription, SUBSCRIPTION_KEYS).length === 0
    if (!shapeOk) { check(where + ' has the v0.15 subscription shape { apiVersion, kind, scope? }', false, JSON.stringify(subscription)); subscriptionsOk = false }
    if (subscription.apiVersion === 'messages.dsh/v1alpha1' && subscription.kind !== 'MessageObserver') {
      check(where + ' references a subscribed event coordinate', false, subscription.apiVersion + '#' + subscription.kind)
      subscriptionsOk = false
    }
  }
  check('every subscription has a valid shape', subscriptionsOk)
  check('this facet subscribes to no protocol events (cordis events are used instead)', subscriptions.length === 0,
    subscriptions.length === 0 ? undefined : 'expected [], got ' + JSON.stringify(subscriptions))
}

// ---------------------------------------------------------------------------
// G. package <-> manifest shipping surface (TUI-DEP-001 artifact)
// ---------------------------------------------------------------------------
if (isProjectManifest) {
  const files = Array.isArray(pkg.files) ? pkg.files : []
  const ships = relative => files.some(pattern => {
    if (typeof pattern !== 'string') return false
    const normalized = pattern.replaceAll('\\', '/').replace(/\/$/u, '')
    return pattern === relative || (normalized !== '' && !normalized.startsWith('!') && (relative.startsWith(normalized + '/') || pattern === relative + '/**'))
  })
  check('package.json files ships dsh-plugin.json', ships('dsh-plugin.json'), JSON.stringify(files))
  check('package.json files ships cordis.patch.yml', ships('cordis.patch.yml'), JSON.stringify(files))
  check('package.json files ships lib/ (built entry)', ships('lib'), JSON.stringify(files))
  check('package.json files ships LICENSE', ships('LICENSE'), JSON.stringify(files))

  const patch = pkg.dsh?.bundle?.patch
  check('package.json dsh.bundle.patch points at cordis.patch.yml', patch === './cordis.patch.yml', String(patch))
  const patchFile = join(root, 'cordis.patch.yml')
  check('cordis.patch.yml exists', existsSync(patchFile), patchFile)
  if (existsSync(patchFile)) {
    const patchText = readFileSync(patchFile, 'utf8')
    check('cordis.patch.yml inserts the profile row', /^\s*-\s*insert:/mu.test(patchText) && /status-rotator/u.test(patchText),
      'expected an "- insert:" section for the status-rotator row')
    const rowId = patchText.match(/^\s*-\s*id:\s*([A-Za-z0-9._-]+)\s*$/mu)?.[1]
    check('cordis.patch.yml row id is the documented settings namespace "status-rotator"', rowId === 'status-rotator', String(rowId))
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('')
if (failures.length > 0) {
  console.error('FAIL: ' + failures.length + ' check(s) failed: ' + failures.join('; '))
  console.error('Hint: TUI Admission v0.15 field shapes live in tui-profile/docs/plugin-admission-and-development.md')
  process.exitCode = 1
} else {
  console.log('ALL PASS: manifest matches the Community v0.15 / TUI Admission v0.15 field shapes' + (warnings.length > 0 ? ' (' + warnings.length + ' warning(s))' : ''))
}
