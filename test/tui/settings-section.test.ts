/**
 * Tests for the declarative /settings section (src/tui/settings-section.ts).
 *
 * Imports the BUILT output (lib/types/tui/settings-section.js).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  EDITABLE_SETTINGS_KEYS,
  SETTINGS_SECTION_TITLE,
  buildSettingsSection,
  registerSettingsSection,
} from '../../lib/types/tui/settings-section.js'

/** The 15 Schemastery-volatile keys declared by src/config.ts. */
const EXPECTED_KEYS = [
  'enabled',
  'language',
  'intervalMs',
  'typeSpeedMs',
  'thinkingMs',
  'longAfterMs',
  'weightedRandom',
  'antiRepeatRecentLimit',
  'labelSource',
  'gradientEnabled',
  'gradientMode',
  'gradientDirection',
  'gradientColors',
  'gradientDayColors',
  'gradientSpeedSec',
]

/** Expected field kind per key (mirrors the Schemastery declarations). */
const EXPECTED_KINDS: Record<string, string> = {
  enabled: 'boolean',
  language: 'select',
  intervalMs: 'number',
  typeSpeedMs: 'number',
  thinkingMs: 'number',
  longAfterMs: 'number',
  weightedRandom: 'boolean',
  antiRepeatRecentLimit: 'number',
  labelSource: 'select',
  gradientEnabled: 'boolean',
  gradientMode: 'select',
  gradientDirection: 'select',
  gradientColors: 'text',
  gradientDayColors: 'text',
  gradientSpeedSec: 'number',
}

/** Collect diagnostics. */
function createDiagnostics() {
  const entries: { code: string; message: string }[] = []
  return {
    entries,
    warn(code: string, message: string) {
      entries.push({ code, message })
    },
    list() {
      return entries.slice()
    },
  }
}

test('EDITABLE_SETTINGS_KEYS mirrors the 15 config.ts editable keys', () => {
  assert.deepEqual([...EDITABLE_SETTINGS_KEYS], EXPECTED_KEYS)
})

test('buildSettingsSection: namespace, title, localized descriptions, own page', () => {
  const section = buildSettingsSection('status-rotator')
  assert.equal(section.ns, 'status-rotator')
  assert.equal(section.title, SETTINGS_SECTION_TITLE)
  assert.equal(section.descriptions.zh, '状态轮换')
  assert.equal(section.descriptions.en, SETTINGS_SECTION_TITLE)
  assert.equal(section.page.id, 'status-rotator')
  assert.equal(section.page.title, SETTINGS_SECTION_TITLE)
  assert.equal(section.page.descriptions.zh, '状态轮换')
})

test('buildSettingsSection: fields cover every editable key exactly once', () => {
  const section = buildSettingsSection('status-rotator')
  assert.equal(section.fields.length, 15)
  const paths = section.fields.map(field => field.path.join('.'))
  assert.deepEqual(paths, EXPECTED_KEYS)
  assert.equal(new Set(paths).size, 15)
})

test('buildSettingsSection: every field carries kind + zh/en label and hint', () => {
  const section = buildSettingsSection('status-rotator')
  for (const field of section.fields) {
    const key = field.path[0]
    assert.equal(field.kind, EXPECTED_KINDS[key], 'kind mismatch for ' + key)
    assert.ok(typeof field.label === 'string' && field.label.length > 0)
    assert.ok(field.descriptions !== undefined && typeof field.descriptions.zh === 'string' && field.descriptions.zh.length > 0, 'missing zh label for ' + key)
    assert.ok(typeof field.descriptions.en === 'string' && field.descriptions.en.length > 0, 'missing en label for ' + key)
    assert.ok(typeof field.hint === 'string' && field.hint.length > 0, 'missing en hint for ' + key)
    assert.ok(field.hintDescriptions !== undefined && typeof field.hintDescriptions.zh === 'string' && field.hintDescriptions.zh.length > 0, 'missing zh hint for ' + key)
    assert.ok(typeof field.hintDescriptions.en === 'string' && field.hintDescriptions.en.length > 0, 'missing en hint for ' + key)
  }
})

test('buildSettingsSection: select fields declare localized options, others do not', () => {
  const section = buildSettingsSection('status-rotator')
  const byKey = new Map(section.fields.map(field => [field.path[0], field]))
  const expectedOptions: Record<string, string[]> = {
    language: ['auto', 'zh', 'en'],
    labelSource: ['phrases', 'host'],
    gradientMode: ['theme', 'day', 'night'],
    gradientDirection: ['rtl', 'ltr'],
  }
  for (const [key, field] of byKey) {
    if (expectedOptions[key] === undefined) {
      assert.equal(field.options, undefined, 'unexpected options on ' + key)
      continue
    }
    assert.ok(Array.isArray(field.options), 'missing options on ' + key)
    assert.deepEqual(field.options.map(option => option.value), expectedOptions[key])
    for (const option of field.options) {
      assert.ok(typeof option.label === 'string' && option.label.length > 0)
      assert.ok(option.descriptions !== undefined)
      assert.ok(typeof option.descriptions.zh === 'string' && option.descriptions.zh.length > 0)
      assert.ok(typeof option.descriptions.en === 'string' && option.descriptions.en.length > 0)
    }
  }
})

test('buildSettingsSection: an illegal page id omits the page but keeps the fields', () => {
  const section = buildSettingsSection('Status Rotator!')
  assert.equal(section.page, undefined)
  assert.equal(section.ns, 'Status Rotator!')
  assert.equal(section.fields.length, 15)
})

test('registerSettingsSection: registers the section and returns the disposer', () => {
  const registered: unknown[] = []
  let disposed = 0
  const ports = {
    entryId: 'status-rotator',
    settingsSections: {
      register(section: unknown) {
        registered.push(section)
        return () => {
          disposed += 1
        }
      },
    },
  }
  const diagnostics = createDiagnostics()
  const dispose = registerSettingsSection({ get: () => undefined } as never, ports as never, {
    ns: 'status-rotator',
    diagnostics: diagnostics as never,
  })
  assert.equal(typeof dispose, 'function')
  assert.equal(registered.length, 1)
  assert.equal((registered[0] as { ns: string }).ns, 'status-rotator')
  assert.equal((registered[0] as { fields: unknown[] }).fields.length, 15)
  assert.equal(diagnostics.entries.length, 0)
  dispose()
  assert.equal(disposed, 1)
})

test('registerSettingsSection: missing seam degrades with a diagnostic', () => {
  const diagnostics = createDiagnostics()
  const result = registerSettingsSection({ get: () => undefined } as never, { entryId: 'x' } as never, {
    ns: 'x',
    diagnostics: diagnostics as never,
  })
  assert.equal(result, undefined)
  assert.equal(diagnostics.entries[0].code, 'settings.unavailable')
})

test('registerSettingsSection: a throwing host register becomes a diagnostic', () => {
  const diagnostics = createDiagnostics()
  const ports = {
    entryId: 'x',
    settingsSections: {
      register() {
        throw new Error('TUI settings section "x" is already registered')
      },
    },
  }
  const result = registerSettingsSection({ get: () => undefined } as never, ports as never, {
    ns: 'x',
    diagnostics: diagnostics as never,
  })
  assert.equal(result, undefined)
  assert.equal(diagnostics.entries[0].code, 'settings.register-failed')
  assert.ok(diagnostics.entries[0].message.includes('already registered'))
})

test('registerSettingsSection: an empty namespace falls back to status-rotator', () => {
  const registered: { ns?: string }[] = []
  const ports = {
    entryId: 'x',
    settingsSections: {
      register(section: { ns: string }) {
        registered.push(section)
        return () => {}
      },
    },
  }
  registerSettingsSection({ get: () => undefined } as never, ports as never, {
    ns: '   ',
    diagnostics: createDiagnostics() as never,
  })
  assert.equal(registered[0].ns, 'status-rotator')
})
