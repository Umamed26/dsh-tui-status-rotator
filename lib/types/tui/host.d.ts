/**
 * dsh-TUI host seam probing.
 *
 * dsh-TUI's plugin seams are optional rows on the cordis composition: a stale
 * profile patch, an older host build, or a Web front door simply does not
 * mount them. Every seam therefore has to be **soft-probed** with
 * `ctx.get(name, false)` (#183 discipline): a missing seam degrades one
 * feature and produces a diagnostic, it never throws and never prevents boot.
 *
 * This module owns only the probe + the safe-cleanup helpers. It imports
 * nothing from dsh-TUI: the seam contracts are the structural copies in
 * `../types.js`, and the identity passed to status/settings registrations is
 * the plugin's own cordis Context (the host's effect ledger attributes the
 * registration from it).
 *
 * @module dsh-tui-status-rotator/tui/host
 */
import type { CommandsService, DiagnosticsSink, TuiPluginHostService, TuiPromptService, TuiSettingsSectionsService, TuiStatusService } from '../types.js';
/** One soft-probe diagnostic: a seam that is missing or has the wrong shape. */
export interface HostDiagnostic {
    /** Stable diagnostic code (shown by /status-rotator status). */
    readonly code: string;
    /** Human-readable description naming the degraded feature. */
    readonly message: string;
}
/**
 * Structural slice of the cordis Context this module needs. Every member is
 * optional so a fake/degraded context probes cleanly instead of throwing.
 * `fiber.entry.options.id` is the Loader entry id of the profile row (also the
 * settings namespace the row's Config owner registers); the TUI's own plugin
 * matrix resolves its settings namespace the same way.
 */
export interface StructuralContext {
    get(name: string, strict?: boolean): unknown;
    logger?: {
        warn(message: string): void;
    };
    fiber?: {
        entry?: {
            options?: {
                id?: string;
            };
        };
    };
}
/** Services this plugin consumes, resolved from the host once at boot. */
export interface HostPorts {
    /** Seam 11: tuiStatus (keyed status line, rich views, footer fields). */
    status?: TuiStatusService;
    /** Seam 6: tuiSettingsSections (declarative /settings section). */
    settingsSections?: TuiSettingsSectionsService;
    /** dsh-commands registry (direct, unattributed registrations). */
    commands?: CommandsService;
    /** tuiPluginHost (mediated command registration with C-041 attribution). */
    pluginHost?: TuiPluginHostService;
    /** Official DSH prompt slot service (dsh-TUI itself does not mount it). */
    prompt?: TuiPromptService;
    /** Profile row id: settings namespace + fallback attribution label. */
    readonly entryId: string;
}
/** Result of probing every seam once at activation time. */
export interface HostProbeResult {
    readonly ports: HostPorts;
    readonly diagnostics: readonly HostDiagnostic[];
}
/**
 * Read the Loader entry id of this plugin row: the settings namespace the row
 * owns. Falls back to the documented default when the context has no Loader
 * entry (bare compositions, tests, embedding).
 */
export declare function resolveEntryId(ctx: StructuralContext | undefined, fallback: string): string;
/**
 * Probe all host seams once. Absent or malformed seams become diagnostics; the
 * returned ports object simply omits them, so callers degrade feature by
 * feature. Never throws, even for a hostile/degraded context.
 */
export declare function probeHostPorts(ctx: StructuralContext, fallbackEntryId: string): HostProbeResult;
/**
 * Invoke one cleanup handle without ever throwing: a disposer that fails must
 * not abort the rest of plugin teardown. Returns whether it ran.
 */
export declare function safeDispose(dispose: unknown, diagnostics: DiagnosticsSink, code?: string): boolean;
/** Run every cleanup handle in reverse registration order, isolating failures. */
export declare function disposeAll(disposers: readonly unknown[], diagnostics: DiagnosticsSink, code?: string): void;
