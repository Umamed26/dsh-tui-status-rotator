/**
 * Runtime diagnostics ring buffer.
 *
 * The plugin must make degradation visible (missing host seam, corrupt bank,
 * invalid config) instead of silently rendering nothing. Every warning goes to
 * the host logger once (deduplicated) and stays available for
 * /status-rotator status.
 *
 * @module dsh-tui-status-rotator/runtime/diagnostics
 */
import type { Diagnostic, DiagnosticsSink } from '../types.js';
/** Bounded, deduplicated diagnostic sink. */
export declare class RuntimeDiagnostics implements DiagnosticsSink {
    private readonly log;
    private readonly clock;
    private readonly entries;
    private readonly seen;
    constructor(log?: (code: string, message: string) => void, clock?: () => number);
    warn(code: string, message: string): void;
    list(): readonly Diagnostic[];
    clear(): void;
}
