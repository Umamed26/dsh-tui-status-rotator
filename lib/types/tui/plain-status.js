/** Key shared with the rich status view (the host keeps one namespace). */
export const PLAIN_STATUS_KEY = 'status-rotator';
/** Host text contributions are capped at 200 cells; longer text is trimmed here. */
const MAX_TEXT_CELLS = 200;
/**
 * Create the plain-text bridge, or `undefined` when `tuiStatus.set` is not
 * available (the caller then reports "no status seam at all"). Never throws.
 */
export function createPlainStatusBridge(ports, diagnostics) {
    const status = ports.status;
    if (status === undefined || status === null || typeof status.set !== 'function') {
        diagnostics.warn('status.plain-unavailable', 'tuiStatus.set is unavailable; the rotating line stays hidden');
        return undefined;
    }
    let disposer;
    let disposed = false;
    /** Release the previous write's token (if the host handed one back). */
    const release = () => {
        const current = disposer;
        disposer = undefined;
        if (typeof current !== 'function')
            return;
        try {
            current();
        }
        catch {
            // A stale token disposer failing must not break the next update.
        }
    };
    return {
        update(text) {
            if (disposed)
                return;
            const value = typeof text === 'string' ? normalizeText(text) : undefined;
            release();
            try {
                const result = status.set(PLAIN_STATUS_KEY, value);
                if (typeof result === 'function')
                    disposer = result;
            }
            catch (error) {
                diagnostics.warn('status.plain-failed', 'tuiStatus.set failed: ' + describe(error));
            }
        },
        dispose() {
            if (disposed)
                return;
            disposed = true;
            release();
            try {
                status.set(PLAIN_STATUS_KEY, undefined);
            }
            catch {
                // Clearing on teardown is best effort; the host also drops plugin
                // contributions on activation dispose when `ctx.effect` is honored.
            }
        },
    };
}
/** Trim the line to the host's cell budget and clear whitespace-only text. */
function normalizeText(text) {
    const trimmed = text.replace(/\s+/gu, ' ').trim();
    if (trimmed === '')
        return undefined;
    if (trimmed.length <= MAX_TEXT_CELLS)
        return trimmed;
    return trimmed.slice(0, MAX_TEXT_CELLS - 1) + ELLIPSIS;
}
const ELLIPSIS = '…';
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
