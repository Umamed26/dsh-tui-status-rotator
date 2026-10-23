import { THEME_GRADIENT_PALETTE } from '../config.js';
/** Default flow period when the config value is unusable (original default: 4s). */
const DEFAULT_GRADIENT_SPEED_MS = 4000;
/** Lazily created grapheme segmenter (undefined when the runtime lacks Intl.Segmenter). */
let segmenter = null;
/** Create the segmenter once; the `null` sentinel means "not available". */
function graphemeSegmenter() {
    if (segmenter !== null)
        return segmenter;
    try {
        segmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
            ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
            : undefined;
    }
    catch {
        segmenter = undefined;
    }
    return segmenter;
}
/**
 * Split text into user-perceived characters (graphemes) so the typewriter and
 * gradient never cut an emoji/ZWJ sequence or a combining mark in half.
 * Falls back to code points when Intl.Segmenter is unavailable.
 */
export function textGraphemes(text) {
    if (typeof text !== 'string' || text.length === 0)
        return [];
    const active = graphemeSegmenter();
    if (active === undefined)
        return Array.from(text);
    const out = [];
    try {
        for (const part of active.segment(text))
            out.push(part.segment);
    }
    catch {
        return Array.from(text);
    }
    return out;
}
/**
 * How many graphemes of `text` are visible at `now`.
 *
 * The first grapheme appears immediately at `startedAt` (no blank frame), then
 * one more per `typeSpeedMs`. `typeSpeedMs <= 0` (and non-finite values)
 * reveal everything at once; times before the start clamp to the first
 * grapheme; the result is capped at the grapheme count.
 */
export function revealCount(text, startedAt, typeSpeedMs, now) {
    const total = textGraphemes(text).length;
    if (total === 0)
        return 0;
    const speed = typeof typeSpeedMs === 'number' && Number.isFinite(typeSpeedMs) ? typeSpeedMs : 0;
    if (speed <= 0)
        return total;
    const start = typeof startedAt === 'number' && Number.isFinite(startedAt) ? startedAt : 0;
    const at = typeof now === 'number' && Number.isFinite(now) ? now : start;
    const elapsed = at - start;
    if (elapsed <= 0)
        return 1;
    return Math.min(total, 1 + Math.floor(elapsed / speed));
}
/** Positive modulo so negative indices wrap into the palette. */
function wrap(value, length) {
    const remainder = value % length;
    return remainder < 0 ? remainder + length : remainder;
}
/** Keep only usable palette entries (non-empty strings); empty means "no gradient". */
function sanitizePalette(palette) {
    if (!Array.isArray(palette))
        return [];
    return palette.filter((color) => typeof color === 'string' && color.length > 0);
}
/**
 * One color per grapheme for the current frame (see the module docs for the
 * exact model). Returns exactly `count` colors; `[]` when the palette is empty
 * or `count` is not positive. A pinned `now`/`startedAt` pair produces an
 * identical array, so the view can stay a pure function of its frame + clock.
 */
export function gradientColors(spec, count, now, startedAt) {
    if (spec === null || typeof spec !== 'object')
        return [];
    const palette = sanitizePalette(spec.palette);
    if (palette.length === 0)
        return [];
    if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0)
        return [];
    const length = palette.length;
    const total = Math.floor(count);
    const speed = typeof spec.speedMs === 'number' && Number.isFinite(spec.speedMs) && spec.speedMs > 0
        ? spec.speedMs
        : 0;
    const start = typeof startedAt === 'number' && Number.isFinite(startedAt) ? startedAt : 0;
    const at = typeof now === 'number' && Number.isFinite(now) ? now : start;
    const elapsed = Math.max(0, at - start);
    const step = speed > 0 ? Math.floor((elapsed / speed) * length) : 0;
    // rtl flows right-to-left: later frames show the color that sat further left.
    const direction = spec.direction === 'ltr' ? -1 : 1;
    const colors = new Array(total);
    for (let index = 0; index < total; index++) {
        colors[index] = palette[wrap(index + direction * step, length)];
    }
    return colors;
}
/**
 * Turn the resolved config into the view's gradient spec.
 *
 * - `gradientEnabled: false` -> undefined (the view renders plain text);
 * - `theme` -> {@link THEME_GRADIENT_PALETTE} (host theme color keys the view's
 *   themed text primitive resolves per light/dark theme);
 * - `day` -> `config.gradientDayColors`; `night` -> `config.gradientColors`;
 * - `speedMs` = `gradientSpeedSec * 1000`, clamped to the config envelope
 *   (1..60s) so a hand-built config can never spin faster than the settings
 *   allow. An empty palette disables the gradient instead of painting one
 *   invisible color.
 */
export function resolveGradientSpec(config) {
    if (config === null || typeof config !== 'object')
        return undefined;
    if (config.gradientEnabled !== true)
        return undefined;
    const mode = config.gradientMode === 'day' || config.gradientMode === 'night'
        ? config.gradientMode
        : 'theme';
    const selected = mode === 'theme'
        ? THEME_GRADIENT_PALETTE
        : mode === 'day'
            ? config.gradientDayColors
            : config.gradientColors;
    const palette = sanitizePalette(selected);
    if (palette.length === 0)
        return undefined;
    const seconds = typeof config.gradientSpeedSec === 'number' && Number.isFinite(config.gradientSpeedSec)
        ? Math.min(60, Math.max(1, config.gradientSpeedSec))
        : 4;
    return {
        mode,
        direction: config.gradientDirection === 'ltr' ? 'ltr' : 'rtl',
        palette: palette.slice(),
        speedMs: Math.round(seconds * 1000),
    };
}
