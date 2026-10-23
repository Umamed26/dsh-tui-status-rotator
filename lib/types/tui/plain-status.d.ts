/**
 * Plain-text status fallback (seam 11: `tuiStatus.set`).
 *
 * When the host has no `tuiStatus.registerView` (older dsh-TUI, a profile patch
 * that dropped the rich-view companion) the plugin still shows the rotating
 * line, but as the host's plain keyed text: no typewriter and no gradient.
 * The line is only a scalar contribution - the host sanitizes and joins it
 * with every other plugin's contributions.
 *
 * The bridge owns its disposer: the host's `set` returns either nothing or a
 * token-scoped disposer, and a write that is superseded by ours must be
 * released before the next write (the host deliberately does not let a stale
 * disposer clear a newer value).
 *
 * @module dsh-tui-status-rotator/tui/plain-status
 */
import type { DiagnosticsSink } from '../types.js';
import type { HostPorts } from './host.js';
/** Key shared with the rich status view (the host keeps one namespace). */
export declare const PLAIN_STATUS_KEY = "status-rotator";
/** The degraded status surface the controller drives instead of the rich view. */
export interface PlainStatusBridge {
    /** Write the current line; `undefined`/`''` clears the contribution. */
    update(text: string | undefined): void;
    /** Release the contribution (plugin unload / rich view became available). */
    dispose(): void;
}
/**
 * Create the plain-text bridge, or `undefined` when `tuiStatus.set` is not
 * available (the caller then reports "no status seam at all"). Never throws.
 */
export declare function createPlainStatusBridge(ports: HostPorts, diagnostics: DiagnosticsSink): PlainStatusBridge | undefined;
