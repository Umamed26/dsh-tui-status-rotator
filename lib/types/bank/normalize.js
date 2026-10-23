import { BUILTIN_PACKS, DEFAULT_ENABLED_PACKS } from './data.js';
export { BUILTIN_PACKS, DEFAULT_ENABLED_PACKS };
/** Longest accepted phrase text, in Unicode code points. */
export const MAX_PHRASE_CODE_POINTS = 200;
/** Weight ceiling (original README: weight cap 1000). */
export const MAX_PHRASE_WEIGHT = 1000;
/** Longest accepted \`when.tool\` name. */
export const MAX_TOOL_NAME_LENGTH = 64;
/** Longest accepted pack id. */
export const MAX_PACK_ID_LENGTH = 64;
const PHASES = ['thinking', 'running', 'long'];
const LANGS = ['zh', 'en'];
/** Keys a \`when\` rule may carry (original WHEN_KEYS). */
const WHEN_KEYS = ['tool', 'retry', 'pending', 'phase', 'hour', 'firstTurn'];
/**
 * Phase values accepted inside \`when.phase\`.
 *
 * The web original also accepts \`idle\`; a dsh-TUI live context only ever has
 * the three turn phases, so an \`idle\` condition can never match. It is kept
 * for input compatibility instead of being silently rewritten — the phrase
 * simply never appears, exactly like a host without idle support.
 */
const WHEN_PHASE_VALUES = ['thinking', 'running', 'long', 'idle'];
/** Keys a phrase entry object may carry. */
const ENTRY_KEYS = ['text', 'weight', 'when', 'rarity'];
/** Keys a bank document may carry; everything else is ignored with a warning. */
const BANK_KEYS = ['phrases', 'packs', 'enabledPacks'];
/** Keys a pack object may carry. */
const PACK_KEYS = ['id', 'label', 'phrases'];
/**
 * C0/C1 control characters. \`\t\`, \`\n\` and \`\r\` are included on purpose: a
 * multi-line phrase would break the one-to-three-line status view, and the
 * built-in corpus contains none.
 */
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;
/** A short warning path like \`packs[1].phrases.zh.thinking[3]\`. */
function at(source, suffix) {
    return suffix === undefined ? source : source + '.' + suffix;
}
/** Push one normalized warning. */
function warn(warnings, code, message) {
    warnings.push({ code, message });
}
/** Structural "plain JSON object" test. */
function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
/** Count Unicode code points without materializing a grapheme array. */
function codePointLength(value) {
    let count = 0;
    for (const _ of value)
        count += 1;
    return count;
}
/** Validate one phrase text; returns undefined (and warns) when unusable. */
function validatePhraseText(value, path, warnings) {
    if (typeof value !== 'string') {
        warn(warnings, 'bank.text-type', path + ': phrase text must be a string');
        return undefined;
    }
    if (value.length === 0 || value.trim().length === 0) {
        warn(warnings, 'bank.text-empty', path + ': phrase text is empty');
        return undefined;
    }
    if (CONTROL_CHARS.test(value)) {
        warn(warnings, 'bank.text-control', path + ': phrase text contains control characters');
        return undefined;
    }
    // Surrogate pairs contribute at most 2 UTF-16 units per code point, so a raw
    // length above twice the cap cannot be short enough.
    if (value.length > MAX_PHRASE_CODE_POINTS * 2) {
        warn(warnings, 'bank.text-too-long', path + ': phrase text exceeds ' + MAX_PHRASE_CODE_POINTS + ' code points');
        return undefined;
    }
    const length = codePointLength(value);
    if (length > MAX_PHRASE_CODE_POINTS) {
        warn(warnings, 'bank.text-too-long', path + ': phrase text is ' + length + ' code points (max ' + MAX_PHRASE_CODE_POINTS + ')');
        return undefined;
    }
    return value;
}
/**
 * Normalize a weight: absent -> 1; illegal -> 1 with a warning (original
 * README "非按 1 处理"); above the cap -> clamped to 1000 with a warning.
 */
function normalizeWeight(value, path, warnings) {
    if (value === undefined)
        return 1;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        warn(warnings, 'bank.weight', path + ': weight must be a positive finite number; using 1');
        return 1;
    }
    if (value > MAX_PHRASE_WEIGHT) {
        warn(warnings, 'bank.weight-clamped', path + ': weight ' + value + ' is above ' + MAX_PHRASE_WEIGHT + '; clamped');
        return MAX_PHRASE_WEIGHT;
    }
    return value;
}
/** Normalize a rarity: absent -> undefined; illegal -> dropped with a warning. */
function normalizeRarity(value, path, warnings) {
    if (value === undefined)
        return undefined;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1) {
        warn(warnings, 'bank.rarity', path + ': rarity must be in (0, 1]; ignored');
        return undefined;
    }
    return value;
}
/** Result of normalizing one \`when\` rule. */
const INVALID_WHEN = Symbol('invalid-when');
/**
 * Normalize one \`when\` rule. A rule that survives validation is returned as a
 * {@link WhenCondition}; \`undefined\` means "no condition"; {@link INVALID_WHEN}
 * means the rule was malformed and the entry must be dropped (a typo must not
 * silently turn a conditional phrase into an unconditional one).
 */
function normalizeWhen(value, path, warnings) {
    if (value === undefined || value === null)
        return undefined;
    if (!isPlainObject(value)) {
        warn(warnings, 'bank.when', path + ': when must be an object');
        return INVALID_WHEN;
    }
    let ok = true;
    for (const key of Object.keys(value)) {
        if (!WHEN_KEYS.includes(key)) {
            warn(warnings, 'bank.when-key', path + '.' + key + ': unknown condition (allowed: ' + WHEN_KEYS.join(', ') + ')');
            ok = false;
        }
    }
    const out = {};
    if (value.tool !== undefined) {
        const valid = (candidate) => typeof candidate === 'string' && candidate.length > 0 && candidate.length <= MAX_TOOL_NAME_LENGTH;
        if (valid(value.tool))
            out.tool = value.tool;
        else if (Array.isArray(value.tool)) {
            const tools = value.tool.filter(valid);
            if (tools.length === 0) {
                warn(warnings, 'bank.when-tool', path + '.tool: expected a non-empty string or string array of tool names');
                ok = false;
            }
            else {
                if (tools.length !== value.tool.length)
                    warn(warnings, 'bank.when-tool', path + '.tool: invalid tool names were dropped');
                out.tool = tools;
            }
        }
        else {
            warn(warnings, 'bank.when-tool', path + '.tool: expected a non-empty string or string array of tool names');
            ok = false;
        }
    }
    for (const key of ['retry', 'firstTurn']) {
        if (value[key] === undefined)
            continue;
        if (typeof value[key] === 'boolean')
            out[key] = value[key];
        else {
            warn(warnings, 'bank.when-boolean', path + '.' + key + ': expected a boolean');
            ok = false;
        }
    }
    if (value.pending !== undefined) {
        if (typeof value.pending === 'boolean')
            out.pending = value.pending;
        else if (typeof value.pending === 'number' && Number.isFinite(value.pending) && value.pending >= 0)
            out.pending = Math.floor(value.pending);
        else {
            warn(warnings, 'bank.when-pending', path + '.pending: expected a boolean or a non-negative number');
            ok = false;
        }
    }
    if (value.phase !== undefined) {
        const valid = (candidate) => typeof candidate === 'string' && WHEN_PHASE_VALUES.includes(candidate);
        if (valid(value.phase))
            out.phase = value.phase;
        else if (Array.isArray(value.phase)) {
            const phases = value.phase.filter(valid);
            if (phases.length === 0) {
                warn(warnings, 'bank.when-phase', path + '.phase: expected ' + WHEN_PHASE_VALUES.join(' / ') + ' or an array of them');
                ok = false;
            }
            else {
                if (phases.length !== value.phase.length)
                    warn(warnings, 'bank.when-phase', path + '.phase: invalid phase values were dropped');
                out.phase = phases;
            }
        }
        else {
            warn(warnings, 'bank.when-phase', path + '.phase: expected ' + WHEN_PHASE_VALUES.join(' / ') + ' or an array of them');
            ok = false;
        }
    }
    if (value.hour !== undefined) {
        const hour = value.hour;
        if (Array.isArray(hour) && hour.length === 2 && hour.every((h) => Number.isInteger(h) && h >= 0 && h <= 23)) {
            out.hour = [hour[0], hour[1]];
        }
        else {
            warn(warnings, 'bank.when-hour', path + '.hour: expected [startHour, endHour] integers 0..23');
            ok = false;
        }
    }
    if (!ok)
        return INVALID_WHEN;
    if (Object.keys(out).length === 0) {
        warn(warnings, 'bank.when-empty', path + ': empty when object means "always"; treated as unconditional');
        return undefined;
    }
    // 'idle' is kept for compatibility even though WhenCondition types the
    // values as Phase; a TUI live phase is never 'idle', so it never matches.
    return out;
}
/**
 * Normalize one phrase entry (string or \`{ text, weight, when, rarity }\`).
 * Returns undefined when the entry is unusable; all reasons are reported.
 */
function normalizeEntry(value, path, warnings) {
    if (typeof value === 'string') {
        const text = validatePhraseText(value, path, warnings);
        if (text === undefined)
            return undefined;
        return { text, weight: 1 };
    }
    if (!isPlainObject(value)) {
        warn(warnings, 'bank.entry', path + ': expected a phrase string or { text, weight, when, rarity } object');
        return undefined;
    }
    for (const key of Object.keys(value)) {
        if (!ENTRY_KEYS.includes(key))
            warn(warnings, 'bank.unknown-field', path + '.' + key + ': unknown phrase field ignored');
    }
    const text = validatePhraseText(value.text, at(path, 'text'), warnings);
    if (text === undefined)
        return undefined;
    const when = normalizeWhen(value.when, at(path, 'when'), warnings);
    if (when === INVALID_WHEN) {
        warn(warnings, 'bank.entry', path + ': entry dropped because its when condition is invalid');
        return undefined;
    }
    const weight = normalizeWeight(value.weight, at(path, 'weight'), warnings);
    const rarity = normalizeRarity(value.rarity, at(path, 'rarity'), warnings);
    const entry = {
        text,
        weight,
        ...(when === undefined ? {} : { when }),
        ...(rarity === undefined ? {} : { rarity }),
    };
    return entry;
}
/**
 * Normalize one phrase entry from untrusted input (single-argument form used
 * by provider merging and by tests). Invalid entries return undefined; no
 * diagnostics are emitted from this signature.
 */
export function normalizePhraseInput(value) {
    return normalizeEntry(value, 'phrase', []);
}
/** Create empty mutable phase groups. */
function emptyGroups() {
    return { thinking: [], running: [], long: [] };
}
/** Publish mutable groups as the immutable PhaseGroups contract shape. */
function finalizeGroups(groups) {
    return { thinking: groups.thinking, running: groups.running, long: groups.long };
}
/** Whether any phase in the groups carries at least one entry. */
function hasEntries(groups) {
    return PHASES.some((phase) => groups[phase].length > 0);
}
/**
 * Normalize one language's phrase groups.
 *
 * Accepted shapes (matching the original \`normalizeGroups\`):
 *   - \`{ thinking: [...], running: [...], long: [...] }\` (missing groups = empty);
 *   - a legacy flat phrase array, treated as the thinking group.
 *
 * Invalid entries are dropped with a warning and the remaining entries are
 * returned; the result always has all three phase arrays.
 *
 * @param input - untrusted phrase-group input.
 * @param source - diagnostic path prefix, e.g. \`packs[2].phrases.zh\`.
 */
export function normalizePhraseGroups(input, source) {
    const warnings = [];
    const groups = emptyGroups();
    if (input === undefined)
        return { groups: finalizeGroups(groups), warnings };
    if (Array.isArray(input)) {
        for (const [index, item] of input.entries()) {
            const entry = normalizeEntry(item, source + '[' + index + ']', warnings);
            if (entry !== undefined)
                groups.thinking.push(entry);
        }
        return { groups: finalizeGroups(groups), warnings };
    }
    if (!isPlainObject(input)) {
        warn(warnings, 'bank.groups', source + ': expected { thinking, running, long } or a legacy phrase array');
        return { groups: finalizeGroups(groups), warnings };
    }
    let recognized = 0;
    for (const key of Object.keys(input)) {
        if (!PHASES.includes(key))
            warn(warnings, 'bank.unknown-field', source + '.' + key + ': unknown phase group ignored');
    }
    for (const phase of PHASES) {
        const list = input[phase];
        if (list === undefined)
            continue;
        recognized += 1;
        if (!Array.isArray(list)) {
            warn(warnings, 'bank.group', source + '.' + phase + ': expected an array; group ignored');
            continue;
        }
        for (const [index, item] of list.entries()) {
            const entry = normalizeEntry(item, source + '.' + phase + '[' + index + ']', warnings);
            if (entry !== undefined)
                groups[phase].push(entry);
        }
    }
    if (recognized === 0) {
        warn(warnings, 'bank.groups', source + ': expected { thinking, running, long } or a legacy phrase array');
    }
    return { groups: finalizeGroups(groups), warnings };
}
/** Normalize a language table: \`{ zh?, en? }\` or a legacy shared group table. */
function normalizeLanguageTable(input, source, warnings) {
    if (!isPlainObject(input)) {
        warn(warnings, 'bank.phrases', source + ': expected { zh, en } language table');
        return undefined;
    }
    const hasLang = input.zh !== undefined || input.en !== undefined;
    if (!hasLang) {
        // Legacy shape: one group table shared by both languages (original
        // normalizeTable fallback).
        const result = normalizePhraseGroups(input, source);
        warnings.push(...result.warnings);
        if (!hasEntries(result.groups))
            return undefined;
        return { zh: result.groups, en: result.groups };
    }
    for (const key of Object.keys(input)) {
        if (key !== 'zh' && key !== 'en')
            warn(warnings, 'bank.unknown-field', source + '.' + key + ': unknown language key ignored');
    }
    const out = {};
    for (const lang of LANGS) {
        const value = input[lang];
        if (value === undefined)
            continue;
        const result = normalizePhraseGroups(value, source + '.' + lang);
        warnings.push(...result.warnings);
        if (hasEntries(result.groups))
            out[lang] = result.groups;
    }
    return Object.keys(out).length > 0 ? out : undefined;
}
/**
 * Normalize one pack object.
 *
 * @param input - untrusted pack input.
 * @param source - diagnostic path prefix, e.g. \`packs[0]\`.
 * @returns the normalized pack, or undefined when unusable.
 */
export function normalizePackInput(input, source) {
    const warnings = [];
    if (!isPlainObject(input)) {
        warn(warnings, 'bank.pack', source + ': expected a pack object');
        return { warnings };
    }
    for (const key of Object.keys(input)) {
        if (!PACK_KEYS.includes(key))
            warn(warnings, 'bank.unknown-field', source + '.' + key + ': unknown pack field ignored');
    }
    const id = input.id;
    if (typeof id !== 'string' || id.trim().length === 0 || id.length > MAX_PACK_ID_LENGTH || CONTROL_CHARS.test(id)) {
        warn(warnings, 'bank.pack-id', source + '.id: expected a non-empty string of at most ' + MAX_PACK_ID_LENGTH + ' characters');
        return { warnings };
    }
    const label = normalizePackLabel(input.label, at(source, 'label'), warnings);
    if (input.phrases === undefined) {
        warn(warnings, 'bank.pack-phrases', source + '.phrases: missing; pack ignored');
        return { warnings };
    }
    if (!isPlainObject(input.phrases)) {
        warn(warnings, 'bank.pack-phrases', source + '.phrases: expected { zh, en } language table; pack ignored');
        return { warnings };
    }
    const phrases = {};
    let count = 0;
    for (const key of Object.keys(input.phrases)) {
        if (key !== 'zh' && key !== 'en')
            warn(warnings, 'bank.unknown-field', source + '.phrases.' + key + ': unknown language ignored');
    }
    for (const lang of LANGS) {
        const value = input.phrases[lang];
        if (value === undefined)
            continue;
        const result = normalizePhraseGroups(value, source + '.phrases.' + lang);
        warnings.push(...result.warnings);
        if (hasEntries(result.groups)) {
            phrases[lang] = result.groups;
            count += PHASES.reduce((total, phase) => total + result.groups[phase].length, 0);
        }
    }
    if (count === 0) {
        warn(warnings, 'bank.pack-empty', source + ': no usable phrases; pack ignored');
        return { warnings };
    }
    const pack = {
        id,
        ...(label === undefined ? {} : { label }),
        phrases,
    };
    return { pack, warnings };
}
/** Normalize a pack label: string or \`{ zh?, en? }\`; empty labels are omitted. */
function normalizePackLabel(value, path, warnings) {
    if (value === undefined)
        return undefined;
    if (typeof value === 'string') {
        const text = value.trim();
        if (text.length === 0)
            return undefined;
        // PackDoc labels are per-language; a bare string is shared.
        return { zh: text, en: text };
    }
    if (!isPlainObject(value)) {
        warn(warnings, 'bank.pack-label', path + ': expected a string or { zh, en } object; ignored');
        return undefined;
    }
    const label = {};
    for (const lang of LANGS) {
        const candidate = value[lang];
        if (candidate === undefined)
            continue;
        if (typeof candidate === 'string' && candidate.trim().length > 0 && !CONTROL_CHARS.test(candidate))
            label[lang] = candidate.trim();
        else
            warn(warnings, 'bank.pack-label', path + '.' + lang + ': expected a non-empty string; ignored');
    }
    return Object.keys(label).length > 0 ? label : undefined;
}
/**
 * Merge additional phrase inputs into one phase list.
 *
 * Entries are normalized first (invalid ones are dropped) and de-duplicated by
 * text against the base list and each other; the first occurrence keeps its
 * weight, so callers control priority through argument order. The controller
 * passes third-party provider phrases with this helper, which is why \`source\`
 * only exists for diagnostics (the merged list has no warning channel).
 *
 * @param base - already normalized entries (highest priority).
 * @param extra - untrusted phrase inputs appended after the base.
 * @param source - diagnostic path prefix used when describing dropped extras.
 */
export function mergePhaseEntries(base, extra, source = 'extra') {
    void source;
    const merged = [];
    const seen = new Set();
    for (const entry of base) {
        if (seen.has(entry.text))
            continue;
        seen.add(entry.text);
        merged.push(entry);
    }
    for (const value of extra) {
        const entry = normalizePhraseInput(value);
        if (entry === undefined || seen.has(entry.text))
            continue;
        seen.add(entry.text);
        merged.push(entry);
    }
    return merged;
}
/** Copy one normalized entry into the merge accumulator, de-duplicating by text. */
function appendEntry(target, seen, phase, entry) {
    if (seen[phase].has(entry.text))
        return false;
    seen[phase].add(entry.text);
    target[phase].push(entry);
    return true;
}
/** Warn about enabled-pack ids that no pack in the list carries. */
function reportUnknownPacks(enabled, packs, warnings) {
    const known = new Set();
    for (const pack of packs) {
        if (pack !== null && typeof pack === 'object' && typeof pack.id === 'string')
            known.add(pack.id);
    }
    for (const id of enabled) {
        if (!known.has(id))
            warn(warnings, 'bank.unknown-pack', 'enabledPacks: unknown pack id "' + id + '" ignored');
    }
}
/**
 * Build one merged, normalized bank from a core table, packs and pack
 * selection.
 *
 * Merge order (first occurrence wins on duplicate text):
 *   core -> enabled packs (in array order) -> extraCore.
 *
 * @param input - core phrases, packs, enabled-pack selection, extra sources.
 * @returns the merged bank plus the packs that contributed at least one entry.
 */
export function mergeBank(input) {
    const warnings = [];
    const merged = { zh: emptyGroups(), en: emptyGroups() };
    const seen = {
        zh: { thinking: new Set(), running: new Set(), long: new Set() },
        en: { thinking: new Set(), running: new Set(), long: new Set() },
    };
    // 1. core
    const core = input.core;
    if (core !== undefined && core !== null) {
        if (typeof core !== 'object' || Array.isArray(core)) {
            warn(warnings, 'bank.core', 'core: expected a { zh, en } language table; ignored');
        }
        else {
            for (const lang of LANGS) {
                const value = core[lang];
                if (value === undefined)
                    continue;
                const result = normalizePhraseGroups(value, 'core.' + lang);
                warnings.push(...result.warnings);
                for (const phase of PHASES) {
                    for (const entry of result.groups[phase])
                        appendEntry(merged[lang], seen[lang], phase, entry);
                }
            }
        }
    }
    // 2. enabled packs, in array order
    const packs = Array.isArray(input.packs) ? input.packs : [];
    const enabledIds = input.enabledPacks === undefined || input.enabledPacks === null
        ? null
        : new Set(input.enabledPacks.filter((id) => typeof id === 'string' && id.length > 0));
    if (enabledIds !== null)
        reportUnknownPacks(enabledIds, packs, warnings);
    const included = [];
    const includedSet = new Set();
    for (const pack of packs) {
        if (pack === null || typeof pack !== 'object' || typeof pack.id !== 'string' || pack.id.length === 0) {
            warn(warnings, 'bank.pack', 'packs: invalid pack entry ignored');
            continue;
        }
        if (enabledIds !== null && !enabledIds.has(pack.id))
            continue;
        let contributed = false;
        const phrases = pack.phrases;
        if (phrases !== undefined && phrases !== null && typeof phrases === 'object') {
            for (const lang of LANGS) {
                const value = phrases[lang];
                if (value === undefined)
                    continue;
                const result = normalizePhraseGroups(value, 'packs[' + JSON.stringify(pack.id) + '].' + lang);
                warnings.push(...result.warnings);
                for (const phase of PHASES) {
                    for (const entry of result.groups[phase]) {
                        if (appendEntry(merged[lang], seen[lang], phase, entry))
                            contributed = true;
                    }
                }
            }
        }
        if (contributed && !includedSet.has(pack.id)) {
            includedSet.add(pack.id);
            included.push(pack.id);
        }
    }
    // 3. runtime-only extra sources
    const extraCore = input.extraCore;
    if (extraCore !== undefined && extraCore !== null && typeof extraCore === 'object') {
        for (const lang of LANGS) {
            const groups = extraCore[lang];
            if (groups === undefined || groups === null || typeof groups !== 'object')
                continue;
            for (const phase of PHASES) {
                const list = groups[phase];
                if (list === undefined)
                    continue;
                if (!Array.isArray(list)) {
                    warn(warnings, 'bank.extra-core', 'extraCore.' + lang + '.' + phase + ': expected an array; ignored');
                    continue;
                }
                for (const [index, value] of list.entries()) {
                    const entry = normalizeEntry(value, 'extraCore.' + lang + '.' + phase + '[' + index + ']', warnings);
                    if (entry === undefined)
                        continue;
                    appendEntry(merged[lang], seen[lang], phase, entry);
                }
            }
        }
    }
    return {
        zh: finalizeGroups(merged.zh),
        en: finalizeGroups(merged.en),
        includedPacks: Object.freeze(included),
        warnings: Object.freeze(warnings),
    };
}
/**
 * Validate and normalize an untrusted bank document.
 *
 * Only \`packs\` / \`phrases\` / \`enabledPacks\` are accepted; every other key is
 * ignored with a warning (the web original's external bank also ignores
 * \`config\`, and this port additionally accepts \`enabledPacks\`).
 *
 * @param input - untrusted JSON value.
 * @param source - diagnostic path prefix (the external loader passes its file path).
 */
export function normalizeBankDoc(input, source = 'bank') {
    const warnings = [];
    if (!isPlainObject(input)) {
        warn(warnings, 'bank.doc', source + ': expected a JSON object');
        return { doc: {}, valid: false, warnings: Object.freeze(warnings) };
    }
    for (const key of Object.keys(input)) {
        if (!BANK_KEYS.includes(key))
            warn(warnings, 'bank.unknown-field', source + '.' + key + ': unknown bank field ignored');
    }
    const recognized = BANK_KEYS.filter((key) => input[key] !== undefined);
    if (recognized.length === 0) {
        warn(warnings, 'bank.doc-empty', source + ': no packs / phrases / enabledPacks keys; document ignored');
        return { doc: {}, valid: false, warnings: Object.freeze(warnings) };
    }
    const doc = {};
    if (input.phrases !== undefined) {
        const phrases = normalizeLanguageTable(input.phrases, source + '.phrases', warnings);
        if (phrases !== undefined)
            doc.phrases = phrases;
    }
    if (input.packs !== undefined) {
        if (!Array.isArray(input.packs)) {
            warn(warnings, 'bank.packs', source + '.packs: expected an array; ignored');
        }
        else {
            const packs = [];
            const ids = new Set();
            for (const [index, value] of input.packs.entries()) {
                const result = normalizePackInput(value, source + '.packs[' + index + ']');
                warnings.push(...result.warnings);
                if (result.pack === undefined)
                    continue;
                if (ids.has(result.pack.id)) {
                    warn(warnings, 'bank.duplicate-pack', source + '.packs[' + index + '].id: duplicate pack id "' + result.pack.id + '"; later pack ignored');
                    continue;
                }
                ids.add(result.pack.id);
                packs.push(result.pack);
            }
            doc.packs = packs;
        }
    }
    if (input.enabledPacks !== undefined) {
        const raw = input.enabledPacks;
        if (raw === null) {
            doc.enabledPacks = null;
        }
        else if (!Array.isArray(raw)) {
            warn(warnings, 'bank.enabled-packs', source + '.enabledPacks: expected an array of pack ids or null; ignored');
        }
        else {
            const ids = [];
            for (const [index, value] of raw.entries()) {
                if (typeof value === 'string' && value.length > 0 && !CONTROL_CHARS.test(value))
                    ids.push(value);
                else
                    warn(warnings, 'bank.enabled-packs', source + '.enabledPacks[' + index + ']: expected a non-empty pack id; ignored');
            }
            doc.enabledPacks = ids;
        }
    }
    return { doc, valid: true, warnings: Object.freeze(warnings) };
}
