/** The invisible frame: nothing rendered, revision still advances on change. */
export const HIDDEN_FRAME = Object.freeze({
    revision: 0,
    visible: false,
    phase: 'thinking',
    lang: 'zh',
    text: '',
    startedAt: 0,
    typeSpeedMs: 0,
});
/** Minimal external store for view frames. */
export class ViewFrameStore {
    frame = HIDDEN_FRAME;
    listeners = new Set();
    get snapshot() {
        return this.frame;
    }
    subscribe = (listener) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };
    /** Publish a new frame. No-ops (and does not notify) on a deep-equal frame. */
    publish(input) {
        if (sameFrame(this.frame, input))
            return;
        this.frame = Object.freeze({ ...input, revision: this.frame.revision + 1 });
        this.emit();
    }
    /** Hide the line (idempotent). */
    hide() {
        if (!this.frame.visible)
            return;
        this.publish({ ...HIDDEN_FRAME, phase: this.frame.phase, lang: this.frame.lang });
    }
    emit() {
        for (const listener of [...this.listeners]) {
            try {
                listener();
            }
            catch {
                // A broken subscriber must not take down the others.
            }
        }
    }
}
/** Compare frames ignoring the revision stamp. */
function sameFrame(current, next) {
    if (current.visible !== next.visible)
        return false;
    if (!next.visible)
        return true;
    if (current.phase !== next.phase || current.lang !== next.lang)
        return false;
    if (current.text !== next.text)
        return false;
    if (current.startedAt !== next.startedAt)
        return false;
    if (current.typeSpeedMs !== next.typeSpeedMs)
        return false;
    const a = current.gradient;
    const b = next.gradient;
    if (a === undefined || b === undefined)
        return a === b;
    return a.mode === b.mode
        && a.direction === b.direction
        && a.speedMs === b.speedMs
        && a.palette.length === b.palette.length
        && a.palette.every((color, index) => color === b.palette[index]);
}
