import type { DiagnosticsSink, Lang } from '../types.js';
import type { HostPorts, StructuralContext } from './host.js';
/** Registered command name (without the leading slash). */
export declare const STATUS_COMMAND_NAME = "status-rotator";
/** What the command drives; supplied by the runtime controller in index.ts. */
export interface StatusCommandDeps {
    /** Force the next phrase (controller.next()). */
    next(): void;
    /** Enable/disable the line for this run (controller.setEnabled()). */
    setEnabled(on: boolean): void;
    /** Multi-line status snapshot rendered by the command surface. */
    statusText(): string;
    /** Whether the line is currently enabled. */
    enabled(): boolean;
    /** UI language for the command messages (resolved by the runtime). */
    lang?(): Lang;
    /** Diagnostics sink for registration/execution degradation. */
    diagnostics?: DiagnosticsSink;
}
/**
 * Register the command. Returns the unregister disposer, or `undefined` when no
 * registration surface accepted the definition (diagnostic emitted, no throw).
 */
export declare function registerStatusCommand(ctx: StructuralContext, ports: HostPorts, deps: StatusCommandDeps): (() => void) | undefined;
