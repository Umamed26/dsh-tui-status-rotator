/** How many diagnostics are retained for the status command. */
const MAX_DIAGNOSTICS = 40;
/** Bounded, deduplicated diagnostic sink. */
export class RuntimeDiagnostics {
    log;
    clock;
    entries = [];
    seen = new Set();
    constructor(log = () => undefined, clock = Date.now) {
        this.log = log;
        this.clock = clock;
    }
    warn(code, message) {
        const key = code + '\u0000' + message;
        if (this.seen.has(key))
            return;
        this.seen.add(key);
        if (this.seen.size > 400)
            this.seen.clear();
        this.entries.push({ code, message, at: this.clock() });
        if (this.entries.length > MAX_DIAGNOSTICS)
            this.entries.shift();
        try {
            this.log(code, message);
        }
        catch {
            // Logging must never break the plugin.
        }
    }
    list() {
        return this.entries.slice();
    }
    clear() {
        this.entries.length = 0;
        this.seen.clear();
    }
}
