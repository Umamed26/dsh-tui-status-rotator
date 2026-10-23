/**
 * Session activity source backed by the host's session-projection registry.
 *
 * Why this exists: dsh-TUI composes plugins as root-level Cordis rows, and in
 * that layout `ctx.on('session/event')` is NOT delivered to plugin rows for
 * live turns (the events are emitted on the agent-scoped fiber branch, not an
 * ancestor of the plugin). The host's `sessionProjections` registry, however,
 * subscribes to the durable session stream itself and folds every event, so
 * its change feed is the reliable observation point for ecosystem plugins.
 *
 * We consume the `workingActivity` projection view (the same host data the
 * TUI's own status line reads) and derive the small live context the
 * controller needs: running phase, turn start instant, first-turn flag and
 * tool labels. Hosts without that projection (or without the registry) simply
 * leave this source empty; the event-based tracker in `phase.ts` remains the
 * fallback.
 *
 * @module dsh-tui-status-rotator/runtime/projection-source
 */
import type { SessionState } from '../types.js';
/** The projection key the host working-activity plugin publishes. */
export declare const ACTIVITY_PROJECTION_KEY = "workingActivity";
/** Structural slice of the host SessionProjectionRegistry this module uses. */
export interface ProjectionRegistryLike {
    onChanged(listener: (session: object, key: string, value: unknown, seq: number) => void): () => void;
}
/** Result of one read. */
export interface ProjectionActivityState {
    readonly session: object;
    readonly state: SessionState;
}
/**
 * Derives live session facts from the `workingActivity` projection change
 * feed. Attach once with the host registry; `stop()` unsubscribes.
 */
export declare class ProjectionActivityFeed {
    private readonly sessions;
    private activeSession;
    private unsubscribe;
    private lastError;
    private changeCounter;
    private readonly onChange;
    /** @param options - optional change hook used for debug counters/telemetry. */
    constructor(options?: {
        readonly onChange?: (info: {
            readonly phase: string;
            readonly running: boolean;
        }) => void;
    });
    /** Number of workingActivity changes folded so far (diagnostics). */
    changeCount(): number;
    /** Attach to the host registry; returns false when the registry is unusable. */
    attach(registry: ProjectionRegistryLike): boolean;
    /** Detach from the registry (plugin unload). */
    stop(): void;
    /** Whether the feed is attached. */
    attached(): boolean;
    /** Last attach failure, for diagnostics. */
    error(): string | undefined;
    /** The session whose activity changed most recently, with derived facts. */
    active(): ProjectionActivityState | undefined;
    /** Number of tracked sessions (diagnostics/tests). */
    size(): number;
    /** Fold one `workingActivity` change into the tracked map. */
    private onActivityChange;
    /** Get or create a bounded tracked record. */
    private track;
    /** Project into the public SessionState shape. */
    private toState;
}
