/** Map `Date.getDay()` (0=Sunday) to ISO weekday 1..7 (Monday=1, Sunday=7). */
export function isoWeekday(day) {
    if (typeof day !== 'number' || !Number.isFinite(day))
        return 0;
    const whole = Math.floor(day);
    if (whole === 0)
        return 7;
    if (whole >= 1 && whole <= 6)
        return whole;
    return 0;
}
/** Parse `HH:MM` (also tolerant of `H:MM`) into minutes since midnight; undefined when invalid. */
function clockMinutes(value) {
    if (typeof value !== 'string')
        return undefined;
    const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
    if (match === null)
        return undefined;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes))
        return undefined;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59)
        return undefined;
    return hours * 60 + minutes;
}
/** Whether one rule's period covers the given ISO weekday + local minute. */
function ruleMatches(rule, weekday, minute) {
    const rawDays = rule.days;
    if (rawDays !== undefined) {
        const wanted = Array.isArray(rawDays)
            ? rawDays.filter(day => Number.isInteger(day) && day >= 1 && day <= 7)
            : [];
        if (wanted.length === 0)
            return false;
        if (wanted.indexOf(weekday) < 0)
            return false;
    }
    const from = clockMinutes(rule.from);
    const to = clockMinutes(rule.to);
    if (from === undefined || to === undefined)
        return false;
    if (from === to)
        return false; // zero-length [from, to) window: never matches
    if (from < to)
        return minute >= from && minute < to;
    return minute >= from || minute < to;
}
/** Whether a rule object is structurally usable; otherwise it is skipped with a warning. */
function isUsableRule(rule) {
    return rule !== null
        && typeof rule === 'object'
        && typeof rule.preset === 'string'
        && rule.preset.length > 0
        && clockMinutes(rule.from) !== undefined
        && clockMinutes(rule.to) !== undefined;
}
/** Resolve the pinned preset, warning when it names an undefined preset. */
function pinnedPreset(knownPresets, activePreset, warnings) {
    if (activePreset === null || activePreset === undefined || activePreset === '')
        return null;
    if (knownPresets.has(activePreset))
        return activePreset;
    warnings.push({
        code: 'preset.unknownActive',
        message: 'activePreset "' + activePreset + '" is not defined; using the built-in phrase bank',
    });
    return null;
}
/**
 * Resolve which preset should be active at `at` (clock injected for tests).
 *
 * @param presets defined presets (only their ids matter here)
 * @param schedule ordered schedule rules (first match wins)
 * @param activePreset preset pinned when no rule matches
 * @param at local date/time to evaluate
 */
export function resolveActivePreset(presets, schedule, activePreset, at) {
    const warnings = [];
    const knownPresets = new Set();
    if (Array.isArray(presets)) {
        for (const preset of presets) {
            if (preset !== null && typeof preset === 'object' && typeof preset.id === 'string' && preset.id.length > 0) {
                knownPresets.add(preset.id);
            }
        }
    }
    const validDate = at instanceof Date && Number.isFinite(at.getTime());
    if (!validDate) {
        warnings.push({
            code: 'schedule.invalidDate',
            message: 'cannot evaluate the preset schedule: the current time is invalid; falling back to activePreset',
        });
        return { presetId: pinnedPreset(knownPresets, activePreset, warnings), warnings };
    }
    const weekday = isoWeekday(at.getDay());
    const minute = at.getHours() * 60 + at.getMinutes();
    if (Array.isArray(schedule)) {
        for (const rule of schedule) {
            if (!isUsableRule(rule)) {
                warnings.push({
                    code: 'schedule.invalidRule',
                    message: 'ignored a malformed schedule rule (needs preset + HH:MM from/to)',
                });
                continue;
            }
            if (!ruleMatches(rule, weekday, minute))
                continue;
            if (knownPresets.has(rule.preset))
                return { presetId: rule.preset, warnings };
            warnings.push({
                code: 'schedule.unknownPreset',
                message: 'schedule rule targets undefined preset "' + rule.preset + '"; rule ignored',
            });
        }
    }
    return { presetId: pinnedPreset(knownPresets, activePreset, warnings), warnings };
}
