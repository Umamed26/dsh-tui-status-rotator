/**
 * Preset/schedule resolution: which phrase preset is active right now.
 *
 * The port keeps the original web plugin's rule model but the TUI port types
 * weekdays as ISO 1..7 (Monday..Sunday) instead of the original JS 0..6, so
 * `Date.getDay()` is mapped here once (Sunday 0 -> 7).
 *
 * Resolution order:
 * 1. if a schedule rule matches the local weekday + minute, the **first**
 *    matching rule in array order wins (rules are ordered, not weighted);
 * 2. a matching rule whose `preset` is not defined is ignored with a warning
 *    and the scan continues (a typo must not silently pin the wrong bank);
 * 3. no rule matches -> the pinned `activePreset`, or `null` (built-in bank);
 * 4. `null`/`undefined` activePreset -> `null`.
 *
 * Time windows are `HH:MM` local, inclusive start / exclusive end, wrapping
 * midnight when `from > to` (`22:00` -> `06:00`). `from === to` is a
 * zero-length window and matches nothing, exactly like the original
 * `matchSchedule` (write `00:00` -> `23:59` for "all day"; note the `when.hour`
 * condition uses the opposite convention where equal bounds mean all day).
 * `days` omitted = every day; an explicit empty list = never.
 *
 * @module dsh-tui-status-rotator/engine/schedule
 */
import type { BankWarning, PresetInput, ScheduleRuleInput } from '../types.js'

/** Result of resolving the active preset (presetId null = built-in bank). */
export interface ActivePresetResolution {
  /** The preset that should be active, or null for the built-in bank. */
  readonly presetId: string | null
  /** Non-fatal issues (unknown preset ids, malformed rules, invalid date). */
  readonly warnings: readonly BankWarning[]
}

/** Map `Date.getDay()` (0=Sunday) to ISO weekday 1..7 (Monday=1, Sunday=7). */
export function isoWeekday(day: number): number {
  if (typeof day !== 'number' || !Number.isFinite(day)) return 0
  const whole = Math.floor(day)
  if (whole === 0) return 7
  if (whole >= 1 && whole <= 6) return whole
  return 0
}

/** Parse `HH:MM` (also tolerant of `H:MM`) into minutes since midnight; undefined when invalid. */
function clockMinutes(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (match === null) return undefined
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return undefined
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return undefined
  return hours * 60 + minutes
}

/** Whether one rule's period covers the given ISO weekday + local minute. */
function ruleMatches(rule: ScheduleRuleInput, weekday: number, minute: number): boolean {
  const rawDays = rule.days
  if (rawDays !== undefined) {
    const wanted = Array.isArray(rawDays)
      ? rawDays.filter(day => Number.isInteger(day) && day >= 1 && day <= 7)
      : []
    if (wanted.length === 0) return false
    if (wanted.indexOf(weekday) < 0) return false
  }
  const from = clockMinutes(rule.from)
  const to = clockMinutes(rule.to)
  if (from === undefined || to === undefined) return false
  if (from === to) return false // zero-length [from, to) window: never matches
  if (from < to) return minute >= from && minute < to
  return minute >= from || minute < to
}

/** Whether a rule object is structurally usable; otherwise it is skipped with a warning. */
function isUsableRule(rule: unknown): rule is ScheduleRuleInput {
  return rule !== null
    && typeof rule === 'object'
    && typeof (rule as { preset?: unknown }).preset === 'string'
    && (rule as { preset: string }).preset.length > 0
    && clockMinutes((rule as { from?: unknown }).from) !== undefined
    && clockMinutes((rule as { to?: unknown }).to) !== undefined
}

/** Resolve the pinned preset, warning when it names an undefined preset. */
function pinnedPreset(
  knownPresets: ReadonlySet<string>,
  activePreset: string | null | undefined,
  warnings: BankWarning[],
): string | null {
  if (activePreset === null || activePreset === undefined || activePreset === '') return null
  if (knownPresets.has(activePreset)) return activePreset
  warnings.push({
    code: 'preset.unknownActive',
    message: 'activePreset "' + activePreset + '" is not defined; using the built-in phrase bank',
  })
  return null
}

/**
 * Resolve which preset should be active at `at` (clock injected for tests).
 *
 * @param presets defined presets (only their ids matter here)
 * @param schedule ordered schedule rules (first match wins)
 * @param activePreset preset pinned when no rule matches
 * @param at local date/time to evaluate
 */
export function resolveActivePreset(
  presets: readonly PresetInput[],
  schedule: readonly ScheduleRuleInput[],
  activePreset: string | null | undefined,
  at: Date,
): ActivePresetResolution {
  const warnings: BankWarning[] = []
  const knownPresets = new Set<string>()
  if (Array.isArray(presets)) {
    for (const preset of presets) {
      if (preset !== null && typeof preset === 'object' && typeof preset.id === 'string' && preset.id.length > 0) {
        knownPresets.add(preset.id)
      }
    }
  }

  const validDate = at instanceof Date && Number.isFinite(at.getTime())
  if (!validDate) {
    warnings.push({
      code: 'schedule.invalidDate',
      message: 'cannot evaluate the preset schedule: the current time is invalid; falling back to activePreset',
    })
    return { presetId: pinnedPreset(knownPresets, activePreset, warnings), warnings }
  }

  const weekday = isoWeekday(at.getDay())
  const minute = at.getHours() * 60 + at.getMinutes()
  if (Array.isArray(schedule)) {
    for (const rule of schedule) {
      if (!isUsableRule(rule)) {
        warnings.push({
          code: 'schedule.invalidRule',
          message: 'ignored a malformed schedule rule (needs preset + HH:MM from/to)',
        })
        continue
      }
      if (!ruleMatches(rule, weekday, minute)) continue
      if (knownPresets.has(rule.preset)) return { presetId: rule.preset, warnings }
      warnings.push({
        code: 'schedule.unknownPreset',
        message: 'schedule rule targets undefined preset "' + rule.preset + '"; rule ignored',
      })
    }
  }

  return { presetId: pinnedPreset(knownPresets, activePreset, warnings), warnings }
}
