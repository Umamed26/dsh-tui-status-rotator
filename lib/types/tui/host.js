/** Short single-line error text for diagnostics (never throws). */
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
/**
 * Read the Loader entry id of this plugin row: the settings namespace the row
 * owns. Falls back to the documented default when the context has no Loader
 * entry (bare compositions, tests, embedding).
 */
export function resolveEntryId(ctx, fallback) {
    try {
        const id = ctx?.fiber?.entry?.options?.id;
        if (typeof id === 'string' && id.trim() !== '')
            return id.trim();
    }
    catch {
        // Degraded context (proxies/getters may throw): keep the fallback.
    }
    const normalizedFallback = typeof fallback === 'string' && fallback.trim() !== '' ? fallback.trim() : 'status-rotator';
    return normalizedFallback;
}
/** Whether `value` exposes `name` as a callable method (never throws). */
function hasMethod(value, name) {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function'))
        return false;
    try {
        return typeof value[name] === 'function';
    }
    catch {
        return false;
    }
}
/**
 * Probe all host seams once. Absent or malformed seams become diagnostics; the
 * returned ports object simply omits them, so callers degrade feature by
 * feature. Never throws, even for a hostile/degraded context.
 */
export function probeHostPorts(ctx, fallbackEntryId) {
    const diagnostics = [];
    const entryId = resolveEntryId(ctx, fallbackEntryId);
    const ports = { entryId };
    const push = (code, message) => {
        diagnostics.push({ code, message });
    };
    const canProbe = ctx !== null && ctx !== undefined && typeof ctx === 'object' && typeof ctx.get === 'function';
    if (!canProbe) {
        push('host.no-context', 'the plugin context has no ctx.get(); every dsh-TUI seam is unavailable and the plugin runs as a no-op');
    }
    const read = (name) => {
        if (!canProbe)
            return undefined;
        try {
            return ctx.get(name, false);
        }
        catch (error) {
            push('host.probe-failed', 'ctx.get("' + name + '", false) threw: ' + describe(error));
            return undefined;
        }
    };
    // Seam 11 - keyed status line + bounded rich views.
    const rawStatus = read('tuiStatus');
    if (rawStatus === undefined) {
        push('host.missing-tuiStatus', 'tuiStatus is not mounted (stale profile patch or non-TUI host); the rotating status line stays hidden');
    }
    else if (!hasMethod(rawStatus, 'set') && !hasMethod(rawStatus, 'registerView')) {
        push('host.invalid-tuiStatus', 'tuiStatus is present but exposes neither set() nor registerView(); the rotating status line stays hidden');
    }
    else {
        ports.status = rawStatus;
        if (!hasMethod(rawStatus, 'registerView')) {
            push('host.no-registerView', 'tuiStatus.registerView is missing on this host; the rotating line downgrades to plain tuiStatus.set text (no typewriter/gradient)');
        }
    }
    // Seam 6 - declarative /settings section.
    const rawSettings = read('tuiSettingsSections');
    if (rawSettings === undefined) {
        push('host.missing-tuiSettingsSections', 'tuiSettingsSections is not mounted; the /settings section is unavailable (edit the profile patch or ~/.dsh/settings.yaml instead)');
    }
    else if (!hasMethod(rawSettings, 'register')) {
        push('host.invalid-tuiSettingsSections', 'tuiSettingsSections is present but has no register(); the /settings section is unavailable');
    }
    else {
        ports.settingsSections = rawSettings;
    }
    // dsh-commands registry (direct / unattributed fallback).
    const rawCommands = read('commands');
    if (rawCommands === undefined) {
        push('host.missing-commands', 'the commands service is not mounted; the /status-rotator command is unavailable');
    }
    else if (!hasMethod(rawCommands, 'register')) {
        push('host.invalid-commands', 'the commands service is present but has no register(); the /status-rotator command is unavailable');
    }
    else {
        ports.commands = rawCommands;
    }
    // tuiPluginHost - mediated command registration (C-041 attribution).
    const rawPluginHost = read('tuiPluginHost');
    if (rawPluginHost === undefined) {
        push('host.missing-tuiPluginHost', 'tuiPluginHost is not mounted; /status-rotator falls back to the unattributed commands.register path');
    }
    else if (!hasMethod(rawPluginHost, 'registerCommand')) {
        push('host.invalid-tuiPluginHost', 'tuiPluginHost is present but has no registerCommand(); /status-rotator falls back to the unattributed commands.register path');
    }
    else {
        ports.pluginHost = rawPluginHost;
    }
    // Official DSH prompt slot. dsh-TUI does not mount this seam: absence is the
    // documented normal case, not a degradation of the dsh-TUI surface.
    const rawPrompt = read('tuiPrompt');
    if (rawPrompt === undefined) {
        push('host.missing-tuiPrompt', 'tuiPrompt is not mounted (dsh-TUI does not provide it); the optional official-TUI prompt slot is skipped');
    }
    else if (!hasMethod(rawPrompt, 'register')) {
        push('host.invalid-tuiPrompt', 'tuiPrompt is present but has no register(); the optional official-TUI prompt slot is skipped');
    }
    else {
        ports.prompt = rawPrompt;
    }
    return { ports, diagnostics };
}
/**
 * Invoke one cleanup handle without ever throwing: a disposer that fails must
 * not abort the rest of plugin teardown. Returns whether it ran.
 */
export function safeDispose(dispose, diagnostics, code = 'cleanup.failed') {
    if (typeof dispose !== 'function')
        return false;
    try {
        ;
        dispose();
        return true;
    }
    catch (error) {
        report(diagnostics, code, 'cleanup callback threw: ' + describe(error));
        return false;
    }
}
/** Run every cleanup handle in reverse registration order, isolating failures. */
export function disposeAll(disposers, diagnostics, code = 'cleanup.failed') {
    for (let index = disposers.length - 1; index >= 0; index -= 1) {
        safeDispose(disposers[index], diagnostics, code);
    }
}
/** Report a diagnostic without letting a broken sink break teardown. */
function report(diagnostics, code, message) {
    try {
        diagnostics.warn(code, message);
    }
    catch {
        // A diagnostics sink must never be able to break cleanup.
    }
}
