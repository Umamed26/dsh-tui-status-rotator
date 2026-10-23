import { gradientColors, revealCount, textGraphemes } from '../engine/render.js';
/** tuiStatus key the rich view and the plain-text fallback share. */
export const STATUS_VIEW_KEY = 'status-rotator';
/** The view is a single line: the host clips at `maxRows` anyway. */
export const STATUS_VIEW_MAX_ROWS = 1;
/** Animation frame interval for the typewriter and the gradient sweep. */
const TICK_MS = 80;
/** Leading phase indicators, one terminal cell each (dim). */
const PHASE_SYMBOLS = Object.freeze({
    thinking: '◌',
    running: '●',
    long: '◍',
});
/** Unknown phase fallback (defensive: frames come from our own controller). */
const UNKNOWN_PHASE_SYMBOL = '·';
/** Cells reserved for the phase indicator + the separating space. */
const INDICATOR_CELLS = 2;
/** The ellipsis earns its own cell when the line has to be cut. */
const ELLIPSIS = '…';
/**
 * Create the React component registered with `tuiStatus.registerView`.
 *
 * The store is injected by closure (the host passes no data props), which is
 * exactly how the dsh-TUI docs describe rich status views: the component owns
 * its live data through an external store.
 */
export function createStatusViewComponent(store) {
    // Stable callbacks: the host's useSyncExternalStore must not resubscribe on
    // every animation tick.
    const subscribe = (listener) => store.subscribe(listener);
    const getSnapshot = () => store.snapshot;
    return function StatusRotatorView(props) {
        const host = props === null || props === undefined ? undefined : props.React;
        const ui = props === null || props === undefined ? undefined : props.ui;
        if (host === undefined || host === null || typeof host.createElement !== 'function' || ui === undefined || ui === null)
            return null;
        // Hooks: unconditional, and always from the INJECTED React instance.
        const frame = host.useSyncExternalStore(subscribe, getSnapshot);
        const [, forceTick] = host.useState(0);
        const size = typeof ui.useTerminalSize === 'function' ? ui.useTerminalSize() : undefined;
        const safeFrame = (frame === null || frame === undefined ? {} : frame);
        const text = typeof safeFrame.text === 'string' ? safeFrame.text : '';
        const visible = safeFrame.visible === true;
        const now = Date.now();
        const graphemes = visible && text !== '' ? safeGraphemes(text) : [];
        const revealed = graphemes.length === 0
            ? 0
            : safeRevealCount(text, safeFrame.startedAt ?? 0, safeFrame.typeSpeedMs ?? 0, now, graphemes.length);
        const gradient = safeFrame.gradient;
        const animating = visible && graphemes.length > 0 && (gradient !== undefined || revealed < graphemes.length);
        host.useEffect(() => {
            if (!animating)
                return undefined;
            const timer = setInterval(() => {
                forceTick(value => value + 1);
            }, TICK_MS);
            return () => {
                clearInterval(timer);
            };
        }, [animating]);
        // Hidden line: render nothing so the host reserves no row.
        if (!visible || text === '' || graphemes.length === 0)
            return null;
        const columns = size !== undefined && typeof size.columns === 'number' && Number.isFinite(size.columns)
            ? Math.floor(size.columns)
            : 0;
        const layout = columns > 0 ? layoutLine(graphemes, revealed, Math.max(1, columns - INDICATOR_CELLS)) : { count: revealed, clipped: false };
        const count = layout.count;
        const phase = safeFrame.phase;
        const symbol = typeof phase === 'string' && Object.prototype.hasOwnProperty.call(PHASE_SYMBOLS, phase)
            ? PHASE_SYMBOLS[phase]
            : UNKNOWN_PHASE_SYMBOL;
        let colors;
        if (gradient !== undefined) {
            const computed = safeGradientColors(gradient, count, now, safeFrame.startedAt ?? 0);
            if (computed.length === count)
                colors = computed;
        }
        const lineChildren = [];
        if (colors === undefined) {
            let plain = '';
            for (let index = 0; index < count; index += 1)
                plain += graphemes[index] ?? '';
            if (layout.clipped)
                plain += ELLIPSIS;
            lineChildren.push(plain);
        }
        else {
            for (let index = 0; index < count; index += 1) {
                const spanProps = { key: 'g' + String(index) };
                const color = colors[index];
                if (color !== undefined)
                    spanProps.color = color;
                lineChildren.push(host.createElement(ui.Text, spanProps, graphemes[index] ?? ''));
            }
            if (layout.clipped)
                lineChildren.push(host.createElement(ui.Text, { key: 'ellipsis', dimColor: true }, ELLIPSIS));
        }
        const line = host.createElement(ui.Text, { key: 'line', wrap: 'truncate-end' }, ...lineChildren);
        return host.createElement(ui.Box, { key: 'row', flexDirection: 'row', flexShrink: 0 }, host.createElement(ui.Text, { key: 'phase', dimColor: true }, symbol + ' '), line);
    };
}
/**
 * Register the rich status view (seam 11).
 *
 * Returns the host's disposer, or `undefined` when the seam is unavailable or
 * refuses the registration - the caller then switches to the plain-text
 * fallback. Refusals are always reported (the host logs its own reason; this
 * adds the plugin-facing diagnostic), never thrown.
 */
export function registerRichStatus(ctx, ports, store, diagnostics) {
    const status = ports.status;
    if (status === undefined || status === null) {
        diagnostics.warn('status.register-view', 'tuiStatus is unavailable; the rich status view cannot be registered');
        return undefined;
    }
    if (typeof status.registerView !== 'function') {
        diagnostics.warn('status.register-view', 'tuiStatus.registerView is unavailable on this host; falling back to plain status text');
        return undefined;
    }
    const descriptor = {
        key: STATUS_VIEW_KEY,
        maxRows: STATUS_VIEW_MAX_ROWS,
        component: createStatusViewComponent(store),
    };
    try {
        // Identity = our own ctx: the host's effect ledger attributes the
        // registration to this activation (and clears it on unload).
        const dispose = status.registerView(descriptor, ctx);
        if (typeof dispose !== 'function') {
            diagnostics.warn('status.register-view-refused', 'the host refused the rich status view "' + STATUS_VIEW_KEY + '" (see the host log); falling back to plain status text');
            return undefined;
        }
        return dispose;
    }
    catch (error) {
        diagnostics.warn('status.register-view-failed', 'tuiStatus.registerView threw: ' + describe(error) + '; falling back to plain status text');
        return undefined;
    }
}
/** Segment text into graphemes; a broken segmenter must not blank the line. */
function safeGraphemes(text) {
    try {
        return textGraphemes(text);
    }
    catch {
        return Array.from(text);
    }
}
/** Clamp the engine's reveal count to `[0, total]`; fall back to "all shown". */
function safeRevealCount(text, startedAt, typeSpeedMs, now, total) {
    try {
        const count = revealCount(text, startedAt, typeSpeedMs, now);
        if (typeof count !== 'number' || !Number.isFinite(count))
            return total;
        return Math.max(0, Math.min(total, Math.floor(count)));
    }
    catch {
        return total;
    }
}
/** One palette color per grapheme; an engine failure degrades to plain text. */
function safeGradientColors(spec, count, now, startedAt) {
    if (spec === undefined)
        return [];
    try {
        const colors = gradientColors(spec, count, now, startedAt);
        return Array.isArray(colors) ? colors : [];
    }
    catch {
        return [];
    }
}
/**
 * Fit the revealed grapheme prefix into the terminal width.
 *
 * Columns are a *budget*: CJK/emoji clusters count as two cells, combining
 * marks as zero. When the prefix does not fit, one cell is reserved for an
 * ellipsis (the host's Text also truncates, but doing it here keeps the
 * gradient span count and the visible width in sync).
 */
function layoutLine(graphemes, revealed, budget) {
    const limit = Math.max(1, Math.floor(budget));
    const cap = Math.max(0, Math.min(graphemes.length, Math.floor(revealed)));
    let used = 0;
    let count = 0;
    while (count < cap) {
        const width = graphemeWidth(graphemes[count] ?? '');
        if (used + width > limit)
            break;
        used += width;
        count += 1;
    }
    if (count >= cap)
        return { count, clipped: false };
    // Reserve one cell for the ellipsis and re-fit.
    const ellipsisLimit = Math.max(1, limit - 1);
    let usedWithEllipsis = 0;
    let countWithEllipsis = 0;
    while (countWithEllipsis < cap) {
        const width = graphemeWidth(graphemes[countWithEllipsis] ?? '');
        if (usedWithEllipsis + width > ellipsisLimit)
            break;
        usedWithEllipsis += width;
        countWithEllipsis += 1;
    }
    return { count: countWithEllipsis, clipped: true };
}
/** Worst-case terminal cell width of one grapheme cluster (never throws). */
function graphemeWidth(grapheme) {
    if (typeof grapheme !== 'string' || grapheme === '')
        return 0;
    let width = 0;
    for (const character of grapheme) {
        const codePoint = character.codePointAt(0);
        if (codePoint === undefined)
            continue;
        width = Math.max(width, codePointWidth(codePoint));
    }
    return width;
}
/** Combining/format/ZWJ code points take no cell of their own. */
function isZeroWidth(codePoint) {
    return ((codePoint >= 0x0300 && codePoint <= 0x036f) // combining diacritics
        || (codePoint >= 0x1ab0 && codePoint <= 0x1aff)
        || (codePoint >= 0x1dc0 && codePoint <= 0x1dff)
        || (codePoint >= 0x20d0 && codePoint <= 0x20ff)
        || (codePoint >= 0xfe20 && codePoint <= 0xfe2f)
        || codePoint === 0x200b // zero-width space
        || codePoint === 0x200c // ZWNJ
        || codePoint === 0x200d // ZWJ
        || codePoint === 0xfeff // BOM
        || (codePoint >= 0xfe00 && codePoint <= 0xfe0f) // variation selectors
        || (codePoint >= 0xe0100 && codePoint <= 0xe01ef)
        || (codePoint >= 0x1f3fb && codePoint <= 0x1f3ff) // skin tone modifiers
    );
}
/** East-Asian-width approximation: wide/fullwidth ranges take two cells. */
function isWide(codePoint) {
    return ((codePoint >= 0x1100 && codePoint <= 0x115f)
        || (codePoint >= 0x2e80 && codePoint <= 0x303e)
        || (codePoint >= 0x3041 && codePoint <= 0x33ff)
        || (codePoint >= 0x3400 && codePoint <= 0x4dbf)
        || (codePoint >= 0x4e00 && codePoint <= 0x9fff)
        || (codePoint >= 0xa000 && codePoint <= 0xa4cf)
        || (codePoint >= 0xa960 && codePoint <= 0xa97f)
        || (codePoint >= 0xac00 && codePoint <= 0xd7a3)
        || (codePoint >= 0xf900 && codePoint <= 0xfaff)
        || (codePoint >= 0xfe10 && codePoint <= 0xfe19)
        || (codePoint >= 0xfe30 && codePoint <= 0xfe6f)
        || (codePoint >= 0xff00 && codePoint <= 0xff60)
        || (codePoint >= 0xffe0 && codePoint <= 0xffe6)
        || (codePoint >= 0x1f300 && codePoint <= 0x1f64f)
        || (codePoint >= 0x1f900 && codePoint <= 0x1f9ff)
        || (codePoint >= 0x20000 && codePoint <= 0x3fffd));
}
/** One code point's terminal width (0, 1 or 2 cells). */
function codePointWidth(codePoint) {
    if (codePoint === 0)
        return 0;
    if (isZeroWidth(codePoint))
        return 0;
    return isWide(codePoint) ? 2 : 1;
}
/** Short single-line error text (never throws). */
function describe(error) {
    try {
        if (error instanceof Error)
            return error.message.replace(/\s+/gu, ' ').slice(0, 200);
        return String(error).replace(/\s+/gu, ' ').slice(0, 200);
    }
    catch {
        return 'unknown error';
    }
}
