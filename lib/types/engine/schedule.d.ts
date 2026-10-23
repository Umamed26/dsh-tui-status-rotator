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
import type { BankWarning, PresetInput, ScheduleRuleInput } from '../types.js';
/** Result of resolving the active preset (presetId null = built-in bank). */
export interface ActivePresetResolution {
    /** The preset that should be active, or null for the built-in bank. */
    readonly presetId: string | null;
    /** Non-fatal issues (unknown preset ids, malformed rules, invalid date). */
    readonly warnings: readonly BankWarning[];
}
/** Map `Date.getDay()` (0=Sunday) to ISO weekday 1..7 (Monday=1, Sunday=7). */
export declare function isoWeekday(day: number): number;
/**
 * Resolve which preset should be active at `at` (clock injected for tests).
 *
 * @param presets defined presets (only their ids matter here)
 * @param schedule ordered schedule rules (first match wins)
 * @param activePreset preset pinned when no rule matches
 * @param at local date/time to evaluate
 */
export declare function resolveActivePreset(presets: readonly PresetInput[], schedule: readonly ScheduleRuleInput[], activePreset: string | null | undefined, at: Date): ActivePresetResolution;
