/**
 * Engine tests for preset/schedule resolution: ISO weekdays, half-open time
 * windows, midnight wrap, first-match order, unknown-preset warnings and the
 * activePreset fallback. Imports the BUILT output (lib/types/engine/schedule.js).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveActivePreset, isoWeekday } from '../../lib/types/engine/schedule.js'
import type { PresetInput, ScheduleRuleInput } from '../../lib/types/types.js'

const PRESETS: readonly PresetInput[] = [{ id: 'work' }, { id: 'night' }, { id: 'weekend' }]

/** Local date helper (month is 1-based here to keep the tests readable). */
function at(month: number, day: number, hour: number, minute: number): Date {
  return new Date(2026, month - 1, day, hour, minute, 0, 0)
}

/** 2026-01-05 is a Monday (ISO 1); 2026-01-04 is a Sunday (ISO 7). */
const MONDAY = at(1, 5, 10, 0)
const SUNDAY = at(1, 4, 10, 0)
const SATURDAY = at(1, 3, 10, 0)

function onlyWarnings(resolution: ReturnType<typeof resolveActivePreset>): string[] {
  return resolution.warnings.map(warning => warning.code)
}

test('isoWeekday maps Date.getDay() to ISO 1..7 (Sunday=7)', () => {
  assert.equal(isoWeekday(0), 7)
  assert.equal(isoWeekday(1), 1)
  assert.equal(isoWeekday(2), 2)
  assert.equal(isoWeekday(3), 3)
  assert.equal(isoWeekday(4), 4)
  assert.equal(isoWeekday(5), 5)
  assert.equal(isoWeekday(6), 6)
  assert.equal(isoWeekday(7), 0)
  assert.equal(isoWeekday(Number.NaN), 0)
})

test('first matching rule wins in array order', () => {
  const first: ScheduleRuleInput = { preset: 'work', from: '09:00', to: '18:00' }
  const second: ScheduleRuleInput = { preset: 'night', from: '09:00', to: '18:00' }
  assert.equal(resolveActivePreset(PRESETS, [first, second], null, MONDAY).presetId, 'work')
  assert.equal(resolveActivePreset(PRESETS, [second, first], null, MONDAY).presetId, 'night')
})

test('rule window is inclusive start, exclusive end', () => {
  const rule: ScheduleRuleInput = { preset: 'work', from: '09:00', to: '17:00' }
  assert.equal(resolveActivePreset(PRESETS, [rule], null, at(1, 5, 9, 0)).presetId, 'work')
  assert.equal(resolveActivePreset(PRESETS, [rule], null, at(1, 5, 16, 59)).presetId, 'work')
  assert.equal(resolveActivePreset(PRESETS, [rule], null, at(1, 5, 8, 59)).presetId, null)
  assert.equal(resolveActivePreset(PRESETS, [rule], null, at(1, 5, 17, 0)).presetId, null)
})

test('weekday filter uses ISO days and Sunday is 7', () => {
  const weekdays: ScheduleRuleInput = { preset: 'work', days: [1, 2, 3, 4, 5], from: '00:00', to: '23:59' }
  const sunday: ScheduleRuleInput = { preset: 'weekend', days: [7], from: '00:00', to: '23:59' }
  assert.equal(resolveActivePreset(PRESETS, [weekdays, sunday], null, MONDAY).presetId, 'work')
  assert.equal(resolveActivePreset(PRESETS, [weekdays, sunday], null, SATURDAY).presetId, null)
  assert.equal(resolveActivePreset(PRESETS, [weekdays, sunday], null, SUNDAY).presetId, 'weekend')
})

test('omitted days mean every day; an explicit empty list never matches', () => {
  const every: ScheduleRuleInput = { preset: 'work', from: '09:00', to: '18:00' }
  assert.equal(resolveActivePreset(PRESETS, [every], null, SUNDAY).presetId, 'work')
  const never: ScheduleRuleInput = { preset: 'work', days: [], from: '00:00', to: '23:59' }
  assert.equal(resolveActivePreset(PRESETS, [never], null, MONDAY).presetId, null)
})

test('window wraps midnight', () => {
  const night: ScheduleRuleInput = { preset: 'night', from: '22:00', to: '06:00' }
  assert.equal(resolveActivePreset(PRESETS, [night], null, at(1, 5, 23, 30)).presetId, 'night')
  assert.equal(resolveActivePreset(PRESETS, [night], null, at(1, 5, 5, 59)).presetId, 'night')
  assert.equal(resolveActivePreset(PRESETS, [night], null, at(1, 5, 6, 0)).presetId, null)
  assert.equal(resolveActivePreset(PRESETS, [night], null, at(1, 5, 12, 0)).presetId, null)
})

test('from === to is a zero-length window and never matches (original semantics)', () => {
  const zero: ScheduleRuleInput = { preset: 'work', from: '09:00', to: '09:00' }
  assert.equal(resolveActivePreset(PRESETS, [zero], null, at(1, 5, 9, 0)).presetId, null)
  assert.equal(resolveActivePreset(PRESETS, [zero], null, at(1, 5, 12, 0)).presetId, null)
})

test('unknown preset ids are skipped with a warning, scanning continues', () => {
  const typo: ScheduleRuleInput = { preset: 'typo', from: '09:00', to: '18:00' }
  const work: ScheduleRuleInput = { preset: 'work', days: [1, 2, 3, 4, 5], from: '00:00', to: '23:59' }
  const resolution = resolveActivePreset(PRESETS, [typo, work], null, MONDAY)
  assert.equal(resolution.presetId, 'work')
  assert.deepEqual(onlyWarnings(resolution), ['schedule.unknownPreset'])
})

test('unknown preset with no later match falls back to activePreset + warning', () => {
  const typo: ScheduleRuleInput = { preset: 'typo', from: '09:00', to: '18:00' }
  assert.deepEqual(onlyWarnings(resolveActivePreset(PRESETS, [typo], 'night', MONDAY)), ['schedule.unknownPreset'])
  const bare = resolveActivePreset(PRESETS, [typo], null, MONDAY)
  assert.equal(bare.presetId, null)
  assert.ok(bare.warnings.length >= 1)
})

test('no rule matches -> pinned activePreset', () => {
  const rule: ScheduleRuleInput = { preset: 'work', from: '09:00', to: '18:00' }
  assert.deepEqual(resolveActivePreset(PRESETS, [rule], 'night', at(1, 5, 23, 0)), { presetId: 'night', warnings: [] })
  assert.deepEqual(resolveActivePreset(PRESETS, [], 'weekend', MONDAY), { presetId: 'weekend', warnings: [] })
  assert.deepEqual(resolveActivePreset(PRESETS, [], null, MONDAY), { presetId: null, warnings: [] })
  assert.deepEqual(resolveActivePreset(PRESETS, [], undefined, MONDAY), { presetId: null, warnings: [] })
})

test('an undefined pinned preset resolves to null with a warning', () => {
  const resolution = resolveActivePreset(PRESETS, [], 'ghost', MONDAY)
  assert.equal(resolution.presetId, null)
  assert.deepEqual(onlyWarnings(resolution), ['preset.unknownActive'])
})

test('malformed rules are warned about and skipped', () => {
  const malformed = { preset: 'work', from: 'nine', to: '18:00' } as unknown as ScheduleRuleInput
  const work: ScheduleRuleInput = { preset: 'work', from: '09:00', to: '18:00' }
  const resolution = resolveActivePreset(PRESETS, [malformed, work], null, MONDAY)
  assert.equal(resolution.presetId, 'work')
  assert.deepEqual(onlyWarnings(resolution), ['schedule.invalidRule'])
})

test('invalid Date falls back to activePreset with a warning', () => {
  const rule: ScheduleRuleInput = { preset: 'work', from: '00:00', to: '23:59' }
  const resolution = resolveActivePreset(PRESETS, [rule], 'night', new Date(Number.NaN))
  assert.equal(resolution.presetId, 'night')
  assert.deepEqual(onlyWarnings(resolution), ['schedule.invalidDate'])
})

test('empty inputs resolve to the built-in bank without warnings', () => {
  assert.deepEqual(resolveActivePreset([], [], null, MONDAY), { presetId: null, warnings: [] })
  assert.deepEqual(
    resolveActivePreset(null as unknown as PresetInput[], null as unknown as ScheduleRuleInput[], null, MONDAY),
    { presetId: null, warnings: [] },
  )
})

test('warnings are a fresh array each call (no shared mutable state)', () => {
  const typo: ScheduleRuleInput = { preset: 'typo', from: '00:00', to: '23:59' }
  const first = resolveActivePreset(PRESETS, [typo], null, MONDAY)
  const second = resolveActivePreset(PRESETS, [typo], null, MONDAY)
  assert.notEqual(first.warnings, second.warnings)
  assert.deepEqual(first.warnings, second.warnings)
})
