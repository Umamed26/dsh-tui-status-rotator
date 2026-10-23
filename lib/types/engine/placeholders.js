import { phaseLabel } from '../locale.js';
/** Names owned by the built-in resolver; third parties must not register them. */
export const BUILTIN_PLACEHOLDER_NAMES = new Set([
    'elapsed', 'phase', 'phaseLabel', 'model', 'provider', 'tps', 'pending', 'tools',
    'running', 'retry', 'retryMax', 'locale', 'date', 'time', 'detail',
]);
/**
 * Valid custom placeholder name shape (same grammar the extension service
 * enforces: an identifier with optional dashes, 1..32 chars).
 */
export const PLACEHOLDER_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;
/** Placeholders are `{name}`; only the same identifier grammar is replaced. */
const PLACEHOLDER_PATTERN = /\{([A-Za-z][A-Za-z0-9_-]{0,31})\}/g;
/** Two-digit zero padding. */
const pad2 = (value) => String(value).padStart(2, '0');
/**
 * Localized duration text, matching the host clock style:
 * zh `1分02秒` / en `1m 02s`; hours keep the same shape
 * (zh `1小时0分00秒`, en `1h 0m 0s`). Negative/NaN input counts as 0.
 *
 * @param ms elapsed milliseconds
 * @param lang UI language
 */
export function formatElapsed(ms, lang) {
    const totalSeconds = Math.max(0, Math.floor((typeof ms === 'number' && Number.isFinite(ms) ? ms : 0) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (lang === 'en') {
        if (hours > 0)
            return hours + 'h ' + minutes + 'm ' + seconds + 's';
        if (minutes > 0)
            return minutes + 'm ' + pad2(seconds) + 's';
        return seconds + 's';
    }
    if (hours > 0)
        return hours + '小时' + minutes + '分' + pad2(seconds) + '秒';
    if (minutes > 0)
        return minutes + '分' + pad2(seconds) + '秒';
    return seconds + '秒';
}
/** Stringify `{pending}`: non-negative integer, invalid values count as 0 (original formatPending). */
function formatPending(value) {
    const numeric = Math.floor(Number(value));
    return String(Number.isFinite(numeric) && numeric > 0 ? numeric : 0);
}
/** `{tps}`: rounded integer, or '' when unknown (original rounds to tokens/second). */
function formatTps(value) {
    return typeof value === 'number' && Number.isFinite(value) ? String(Math.round(value)) : '';
}
/** `{model}` / `{provider}`: value or an em dash when the host does not expose it. */
function formatIdentity(value) {
    return typeof value === 'string' && value.length > 0 ? value : '—';
}
/**
 * Build the built-in placeholder values for one frame. Map keys are exactly
 * {@link BUILTIN_PLACEHOLDER_NAMES}; every built-in is always present, so an
 * empty value (`{tps}` when unknown) is a valid replacement rather than an
 * unknown placeholder.
 */
function builtinValues(live) {
    const values = new Map();
    const date = new Date(typeof live.now === 'number' && Number.isFinite(live.now) ? live.now : Number.NaN);
    const validDate = Number.isFinite(date.getTime());
    const retry = typeof live.retry === 'number' && Number.isFinite(live.retry) && live.retry > 0
        ? Math.floor(live.retry)
        : 0;
    const retryMax = retry > 0 && typeof live.retryMax === 'number' && Number.isFinite(live.retryMax)
        ? Math.floor(live.retryMax)
        : undefined;
    const tools = Array.isArray(live.tool)
        ? live.tool.filter((name) => typeof name === 'string' && name.length > 0)
        : [];
    const phase = live.phase;
    const lang = live.lang === 'en' ? 'en' : 'zh';
    values.set('elapsed', formatElapsed(live.elapsedMs, lang));
    values.set('phase', String(phase));
    values.set('phaseLabel', phaseLabel(phase, lang));
    values.set('model', formatIdentity(live.model));
    values.set('provider', formatIdentity(live.provider));
    values.set('tps', formatTps(live.tps));
    values.set('pending', formatPending(live.pending));
    values.set('tools', tools.length > 0 ? tools.join('+') : '—');
    values.set('running', live.running === true ? 'run' : 'idle');
    values.set('retry', retry > 0 ? String(retry) : '');
    values.set('retryMax', retryMax === undefined ? '' : String(retryMax));
    values.set('locale', lang);
    values.set('date', validDate
        ? date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate())
        : '');
    values.set('time', validDate
        ? pad2(date.getHours()) + ':' + pad2(date.getMinutes()) + ':' + pad2(date.getSeconds())
        : '');
    // Observation badge: the "⟳ 3/5" detail from the original plugin, with the
    // dangling separator trimmed when the retry cap is unknown ("⟳ 3").
    values.set('detail', retry > 0
        ? '⟳ ' + retry + (retryMax === undefined ? '' : '/' + retryMax)
        : '');
    return values;
}
/** Whether `name` belongs to the built-in resolver. */
export function isBuiltinPlaceholder(name) {
    return BUILTIN_PLACEHOLDER_NAMES.has(name);
}
/**
 * Create the placeholder resolver. Built-ins win; `LiveContext.vars` fills
 * names the resolver does not own; anything left is kept verbatim and
 * reported through `unknown` (each name at most once, first-seen order).
 */
export function createPlaceholderResolver() {
    return {
        resolve(text, live) {
            const unknown = [];
            if (typeof text !== 'string' || text.length === 0) {
                return { text: typeof text === 'string' ? text : '', unknown };
            }
            const values = builtinValues(live);
            const vars = live !== null && typeof live === 'object' && live.vars !== null && typeof live.vars === 'object'
                ? live.vars
                : undefined;
            const resolved = text.replace(PLACEHOLDER_PATTERN, (match, name) => {
                const builtin = values.get(name);
                if (builtin !== undefined)
                    return builtin;
                if (vars !== undefined && Object.prototype.hasOwnProperty.call(vars, name)) {
                    const value = vars[name];
                    if (typeof value === 'string')
                        return value;
                }
                if (unknown.indexOf(name) < 0)
                    unknown.push(name);
                return match;
            });
            return { text: resolved, unknown };
        },
    };
}
