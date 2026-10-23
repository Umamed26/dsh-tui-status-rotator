/**
 * dsh-tui-status-rotator - a port of dsh-status-rotator to dsh-TUI.
 *
 * The web original rewrites the browser status label with phase-aware rotating
 * phrases (typewriter, day/night gradient, weighted shuffle-bag selection,
 * packs, conditions, placeholders, presets/schedule). dsh-TUI exposes that
 * surface through its plugin seams:
 *
 * - seam 11 tuiStatus.registerView: the rich rotating line above the prompt
 *   (falls back to tuiStatus.set plain text when the host refuses rich views);
 * - seam 6 tuiSettingsSections: a native /settings section over this plugin's
 *   config namespace;
 * - dsh-commands: the /status-rotator command (next / on / off / status);
 * - ctx.provide('statusRotator'): the extension API other plugins can use.
 *
 * Everything degrades to a no-op with a visible diagnostic: a missing seam, a
 * corrupt bank or a bad config never breaks TUI boot.
 *
 * ## Why registrations are deferred
 * dsh-TUI composes profile rows concurrently: this plugin row may be applied
 * before the host's extension rows have published `tuiStatus` /
 * `tuiSettingsSections`. A one-shot `ctx.get()` probe at apply time then
 * misses the seam forever and the rotating line never appears even though the
 * host supports it (found in real TTY replay). Every host-service-dependent
 * registration therefore waits on `ctx.inject([service], cb)`, which fires when
 * the service becomes available and stays pending (harmless) when a non-TUI
 * host never mounts it. The one-shot probe remains the fallback for structural
 * contexts without `inject` (tests, embeds).
 *
 * @module dsh-tui-status-rotator
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Config, detectLanguage, resolveConfig } from './config.js';
import { t } from './locale.js';
import { RuntimeDiagnostics } from './runtime/diagnostics.js';
import { ViewFrameStore } from './runtime/store.js';
import { SessionPhaseTracker } from './runtime/phase.js';
import { ProjectionActivityFeed } from './runtime/projection-source.js';
import { RotationController } from './runtime/controller.js';
import { assembleBankSources } from './runtime/bank-sources.js';
import { createExtensionState, createStatusRotatorService, packPhraseProvider, resolveExtensionPlaceholders, } from './runtime/service.js';
import { BUILTIN_PACKS, DEFAULT_ENABLED_PACKS } from './bank/index.js';
import { createExternalBank } from './bank/external.js';
import { probeHostPorts } from './tui/host.js';
import { registerRichStatus } from './tui/status-view.js';
import { createPlainStatusBridge } from './tui/plain-status.js';
import { registerSettingsSection } from './tui/settings-section.js';
import { registerStatusCommand } from './tui/commands.js';
export const name = 'status-rotator';
/** Re-export the config schema so the cordis entry owns the documented contract. */
export { Config };
/** The profile row id used as fallback settings namespace. */
const DEFAULT_ENTRY_ID = 'status-rotator';
/** How long to wait for the host's extension rows before reporting a missing seam. */
const SEAM_WAIT_MS = 10_000;
/**
 * Read ~/.dsh-tui/lang.json best-effort; the TUI language picker persists the
 * UI language there. Missing/corrupt file just falls through to the OS locale.
 */
function readTuiLanguageFile() {
    try {
        const raw = JSON.parse(readFileSync(join(homedir(), '.dsh-tui', 'lang.json'), 'utf8'));
        if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
            const lang = raw.lang;
            return typeof lang === 'string' ? lang : undefined;
        }
    }
    catch {
        // No language file: fall through.
    }
    return undefined;
}
/** Resolve the configured phrase language; 'auto' follows the host language. */
function resolveLanguage(config) {
    if (config.language === 'zh' || config.language === 'en')
        return config.language;
    let locale = 'en';
    try {
        locale = Intl.DateTimeFormat().resolvedOptions().locale;
    }
    catch {
        // Older runtimes: keep the default.
    }
    return detectLanguage(process.env, readTuiLanguageFile, locale);
}
/** Short single-line error text for diagnostics. */
function describe(error) {
    if (error instanceof Error)
        return error.message.replace(/\s+/g, ' ').slice(0, 200);
    return String(error).replace(/\s+/g, ' ').slice(0, 200);
}
/**
 * Wire the plugin into the cordis application.
 * @param ctx - Cordis context (dsh-TUI's plugin seams live on it).
 * @param config - Row config from the profile patch; every key is optional.
 */
export function apply(ctx, config = {}) {
    const diagnostics = new RuntimeDiagnostics((code, message) => {
        try {
            ctx.logger.warn('[dsh-tui-status-rotator] ' + message + ' (' + code + ')');
        }
        catch {
            // Logging must never break boot.
        }
    });
    // ---- host seams ---------------------------------------------------------
    const structural = ctx;
    const probed = probeHostPorts(structural, DEFAULT_ENTRY_ID);
    const ports = probed.ports;
    const entryId = ports.entryId;
    const canInjectEarly = typeof ctx.inject === 'function';
    for (const warning of probed.diagnostics) {
        // With ctx.inject available, a missing host service is only missing *now*:
        // the deferred registration retries when the host row mounts it. The
        // late-warning timers own that report; forwarding the boot probe too would
        // claim a failure that may resolve milliseconds later.
        if (canInjectEarly && warning.code.startsWith('host.missing-'))
            continue;
        diagnostics.warn(warning.code, warning.message);
    }
    // ---- configuration ------------------------------------------------------
    let resolved = resolveConfig(config);
    for (const warning of resolved.warnings)
        diagnostics.warn(warning.code, warning.message);
    let lang = resolveLanguage(resolved.config);
    // ---- phrase bank --------------------------------------------------------
    let externalDocument = null;
    const store = new ViewFrameStore();
    const tracker = new SessionPhaseTracker();
    // Debug counters distinguish "no phrase" from "no session events" and from
    // "no host seam": all three look identical on screen. Enable with
    // DSH_TUI_STATUS_ROTATOR_DEBUG=1; output goes to stderr only (a TUI must
    // keep stdout quiet).
    const debugEnabled = process.env.DSH_TUI_STATUS_ROTATOR_DEBUG === '1';
    // stderr competes with the TUI's raw-mode screen writes (a debug line can be
    // torn apart by escape sequences), so an explicit file target is available
    // for replay forensics: DSH_TUI_STATUS_ROTATOR_DEBUG_FILE=/path/to.log.
    const debugFile = debugEnabled ? process.env.DSH_TUI_STATUS_ROTATOR_DEBUG_FILE : undefined;
    const counters = { sessionEvents: 0, agentStatusEvents: 0, projectionEvents: 0, publishes: 0 };
    const debug = (message) => {
        if (!debugEnabled)
            return;
        const line = '[status-rotator] ' + message + '\n';
        try {
            process.stderr.write(line);
        }
        catch {
            // Debug output must never break the plugin.
        }
        if (debugFile !== undefined && debugFile !== '') {
            try {
                appendFileSync(debugFile, line);
            }
            catch {
                // Best effort.
            }
        }
    };
    store.subscribe(() => {
        counters.publishes += 1;
        const frame = store.snapshot;
        debug('frame #' + counters.publishes + ' visible=' + frame.visible + ' phase=' + frame.phase + ' text=' + JSON.stringify(frame.text.slice(0, 60)));
    });
    // ---- session projections (authoritative activity source in dsh-TUI) -----
    const projectionFeed = new ProjectionActivityFeed({
        onChange: info => {
            counters.projectionEvents += 1;
            debug('projection change #' + counters.projectionEvents + ' phase=' + info.phase + ' running=' + info.running);
        },
    });
    const rawGet = ctx.get;
    const projections = typeof rawGet === 'function' ? rawGet.call(ctx, 'sessionProjections', false) : undefined;
    if (projections !== null && projections !== undefined && typeof projections.onChanged === 'function') {
        const attached = projectionFeed.attach(projections);
        if (!attached) {
            diagnostics.warn('host.projection-attach', 'session projections rejected the activity subscription: ' + (projectionFeed.error() ?? 'unknown'));
        }
        else {
            debug('projection feed attached');
        }
    }
    else {
        diagnostics.warn('host.no-session-projections', 'sessionProjections service is unavailable; phase tracking falls back to session/event listeners');
    }
    const extensionState = createExtensionState();
    const builtinPackProvider = packPhraseProvider(extensionState);
    const externalBank = createExternalBank({
        ...(resolved.config.bankPath === null ? {} : { file: resolved.config.bankPath }),
        env: process.env,
        onReload(document) {
            externalDocument = document;
            const next = assembleBankSources({
                builtinPacks: BUILTIN_PACKS,
                defaultEnabledPacks: DEFAULT_ENABLED_PACKS,
                external: externalDocument,
                config: resolved.config,
            });
            controller.setSources(next);
        },
        log(code, message) {
            diagnostics.warn(code, message);
        },
    });
    const initialSources = assembleBankSources({
        builtinPacks: BUILTIN_PACKS,
        defaultEnabledPacks: DEFAULT_ENABLED_PACKS,
        external: externalDocument,
        config: resolved.config,
    });
    // ---- controller ---------------------------------------------------------
    const controller = new RotationController({
        config: resolved.config,
        sources: initialSources,
        lang,
        store,
        diagnostics,
        state: () => projectionFeed.active()?.state ?? tracker.active()?.state,
        providers: () => [builtinPackProvider, ...extensionState.providers],
        placeholders: live => resolveExtensionPlaceholders(extensionState, diagnostics, live),
    });
    // ---- extension service (ctx.statusRotator, port of the web original) ----
    let richRegistered = false;
    // "plainStatus" reports the plain tuiStatus.set seam being available (the
    // host capability), not the fallback bridge having been chosen: a host can
    // offer both, and the diagnostics must show what the host supports.
    let statusSeamAvailable = ports.status !== undefined;
    let settingsRegistered = false;
    let commandRegistered = false;
    const hostFlags = () => ({
        richStatusView: richRegistered,
        plainStatus: statusSeamAvailable,
        settingsSection: settingsRegistered,
        commands: commandRegistered,
    });
    const service = createStatusRotatorService({
        state: extensionState,
        diagnostics,
        hostFlags,
        engineSnapshot: () => controller.engineSnapshot(),
        includedPacks: () => controller.status().packs,
    });
    let disposeService;
    const provide = ctx.provide;
    if (typeof provide === 'function') {
        try {
            disposeService = provide.call(ctx, 'statusRotator', service);
        }
        catch (error) {
            diagnostics.warn('service.provide', 'cannot provide ctx.statusRotator: ' + describe(error));
        }
    }
    // ---- session tracking ---------------------------------------------------
    const structuralCtx = ctx;
    structuralCtx.on('session/event', (session, event) => {
        counters.sessionEvents += 1;
        tracker.onSessionEvent(session, event);
        if (debugEnabled) {
            const type = event !== null && typeof event === 'object' ? String(event.type) : '?';
            const state = tracker.active()?.state;
            debug('session/event #' + counters.sessionEvents + ' type=' + type + ' running=' + (state?.running ?? false) + ' sessions=' + tracker.size());
        }
        controller.tick();
    });
    structuralCtx.on('agent/status', payload => {
        counters.agentStatusEvents += 1;
        const event = payload;
        const session = event.agent === undefined ? undefined : event.agent.session;
        if (session !== undefined && session !== null && typeof session === 'object') {
            tracker.onAgentStatus(session, typeof event.status === 'string' ? event.status : 'running');
            controller.tick();
        }
    });
    structuralCtx.on('session/disposed', session => {
        if (session !== null && typeof session === 'object')
            tracker.disposeSession(session);
        controller.tick();
    });
    // Live config edits (settings form) arrive as loader volatile updates; re-read
    // the getters and apply them without a restart.
    structuralCtx.on('loader/volatile-update', () => {
        const next = resolveConfig(config);
        for (const warning of next.warnings)
            diagnostics.warn(warning.code, warning.message);
        resolved = next;
        controller.setConfig(resolved.config);
        const nextLang = resolveLanguage(resolved.config);
        if (nextLang !== lang) {
            lang = nextLang;
            controller.setLanguage(lang);
        }
    });
    // ---- presentation seams (deferred until the host row is mounted) --------
    let richDispose;
    let plain;
    let unsubscribePlain;
    let settingsDispose;
    let commandDispose;
    const seamTimers = [];
    const warnIfLate = (isRegistered, code, message) => {
        const timer = setTimeout(() => {
            if (!isRegistered())
                diagnostics.warn(code, message);
        }, SEAM_WAIT_MS);
        const maybeUnref = timer;
        maybeUnref.unref?.();
        seamTimers.push(timer);
    };
    warnIfLate(() => richRegistered || plain !== undefined, 'host.missing-tuiStatus', 'tuiStatus never became available; the rotating status line stays hidden');
    warnIfLate(() => settingsRegistered, 'host.missing-tuiSettingsSections', 'tuiSettingsSections never became available; the /settings section is unavailable');
    warnIfLate(() => commandRegistered, 'host.missing-commands', 'commands never became available; /status-rotator is unavailable');
    const wireStatus = (seamCtxRaw) => {
        const seamCtx = seamCtxRaw;
        const seamProbed = probeHostPorts(seamCtx, entryId);
        const seamPorts = seamProbed.ports;
        if (seamPorts.status === undefined) {
            if (!ctx.inject) {
                diagnostics.warn('host.missing-tuiStatus', 'tuiStatus is not mounted (stale profile patch or non-TUI host); the rotating status line stays hidden');
                diagnostics.warn('host.no-status-seam', 'tuiStatus exposes neither a rich view nor a text setter; the rotating line stays hidden');
            }
            return;
        }
        statusSeamAvailable = true;
        const dispose = registerRichStatus(seamCtx, seamPorts, store, diagnostics);
        if (dispose !== undefined) {
            richDispose = dispose;
            richRegistered = true;
            debug('wired rich status view (maxRows=1)');
            return;
        }
        const bridge = createPlainStatusBridge(seamPorts, diagnostics);
        if (bridge === undefined) {
            diagnostics.warn('host.no-status-seam', 'tuiStatus exposes neither a rich view nor a text setter; the rotating line stays hidden');
            return;
        }
        plain = bridge;
        unsubscribePlain = store.subscribe(() => {
            const frame = store.snapshot;
            plain?.update(frame.visible ? frame.text : undefined);
        });
        diagnostics.warn('host.plain-fallback', 'rich status views are unavailable; using plain tuiStatus.set text (no typewriter/gradient)');
        debug('wired plain status bridge');
    };
    const wireSettings = (seamCtxRaw) => {
        const seamCtx = seamCtxRaw;
        const seamProbed = probeHostPorts(seamCtx, entryId);
        if (seamProbed.ports.settingsSections === undefined) {
            if (!ctx.inject) {
                diagnostics.warn('host.missing-tuiSettingsSections', 'tuiSettingsSections is not mounted; the /settings section is unavailable');
            }
            return;
        }
        const dispose = registerSettingsSection(seamCtx, seamProbed.ports, {
            ns: entryId,
            diagnostics,
        });
        if (dispose !== undefined) {
            settingsDispose = dispose;
            settingsRegistered = true;
            debug('wired settings section ns=' + entryId);
        }
    };
    const statusText = () => {
        const status = controller.status();
        const flags = hostFlags();
        const active = projectionFeed.active() ?? tracker.active();
        const state = active === undefined ? undefined : active.state;
        const errors = diagnostics.list();
        const errorText = errors.length === 0 ? 'none' : errors.slice(-2).map(entry => entry.code).join(',');
        const rawLine = (status.line === undefined ? '-' : status.line).replace(/\s+/g, ' ');
        const line = rawLine.length > 40 ? rawLine.slice(0, 39) + '…' : rawLine;
        const trackerInfo = 'sessions=' + tracker.size()
            + ' proj=' + (projectionFeed.attached() ? 'on/' + projectionFeed.changeCount() : 'off')
            + ' active=' + (state === undefined ? 'none' : state.running ? 'running' : 'idle')
            + ' events=' + counters.sessionEvents + '/' + counters.agentStatusEvents
            + ' frames=' + counters.publishes;
        return [
            t(lang, 'status.header') + ' ' + (status.enabled ? 'on' : 'off') + ' lang=' + status.lang + ' phase=' + (status.phase ?? 'none'),
            'view=' + mark(flags.richStatusView) + ' set=' + mark(flags.plainStatus) + ' settings=' + mark(flags.settingsSection) + ' cmd=' + mark(flags.commands),
            trackerInfo + ' packs=' + status.packs.length + ' preset=' + (status.presetId ?? 'none'),
            'line=' + line + ' errors=' + errorText,
        ].join(' ; ');
    };
    const wireCommands = (seamCtxRaw) => {
        const seamCtx = seamCtxRaw;
        const seamProbed = probeHostPorts(seamCtx, entryId);
        const seamPorts = seamProbed.ports;
        if (seamPorts.commands === undefined && seamPorts.pluginHost === undefined) {
            if (!ctx.inject) {
                diagnostics.warn('host.missing-commands', 'commands is not mounted; /status-rotator is unavailable');
            }
            return;
        }
        const dispose = registerStatusCommand(seamCtx, seamPorts, {
            next: () => controller.next(),
            setEnabled: enabled => controller.setEnabled(enabled),
            enabled: () => controller.enabled(),
            statusText,
            lang: () => lang,
            diagnostics,
        });
        if (dispose !== undefined) {
            commandDispose = dispose;
            commandRegistered = true;
            debug('wired /status-rotator command (mediated=' + mark(seamPorts.pluginHost !== undefined) + ')');
        }
    };
    const inject = ctx.inject;
    const canInject = typeof inject === 'function';
    if (canInject) {
        const defer = (deps, callback, fallback) => {
            try {
                inject.call(ctx, deps, callback);
            }
            catch (error) {
                diagnostics.warn('host.inject-failed', 'ctx.inject(["' + deps.join('","') + '"]) failed: ' + describe(error));
                fallback();
            }
        };
        defer(['tuiStatus'], wireStatus, () => wireStatus(ctx));
        defer(['tuiSettingsSections'], wireSettings, () => wireSettings(ctx));
        defer(['commands'], wireCommands, () => wireCommands(ctx));
    }
    else {
        wireStatus(ctx);
        wireSettings(ctx);
        wireCommands(ctx);
    }
    // ---- lifecycle ----------------------------------------------------------
    ctx.effect(() => () => {
        for (const timer of seamTimers) {
            try {
                clearTimeout(timer);
            }
            catch {
                // ignore
            }
        }
        try {
            controller.stop();
        }
        catch {
            // ignore
        }
        try {
            externalBank.stop();
        }
        catch {
            // ignore
        }
        try {
            projectionFeed.stop();
        }
        catch {
            // ignore
        }
        try {
            unsubscribePlain?.();
        }
        catch {
            // ignore
        }
        try {
            plain?.dispose();
        }
        catch {
            // ignore
        }
        try {
            richDispose?.();
        }
        catch {
            // ignore
        }
        try {
            settingsDispose?.();
        }
        catch {
            // ignore
        }
        try {
            commandDispose?.();
        }
        catch {
            // ignore
        }
        try {
            disposeService?.();
        }
        catch {
            // ignore
        }
        tracker.clear();
        store.hide();
    }, 'status-rotator lifecycle');
    externalBank.start();
    controller.start();
}
/** One-line yes/no marker for the status command output. */
function mark(value) {
    return value ? 'on' : 'off';
}
