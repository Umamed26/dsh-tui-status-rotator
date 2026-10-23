/**
 * Session phase tracking: folds the durable DSH session event stream into the
 * small set of live facts the rotation engine and placeholders need (turn
 * window, running tools, retries, pending approvals).
 *
 * The plugin is a pure observer here: it never appends session events, never
 * writes the log, and keeps at most MAX_SESSIONS tracked sessions (the TUI
 * can have background sessions). A session disappears from the map on
 * session/disposed.
 *
 * @module dsh-tui-status-rotator/runtime/phase
 */
import type { Phase, PhaseClockConfig, SessionState } from '../types.js';
/** Defensive view of one session event (external data, never trusted). */
export interface ObservedSessionEvent {
    readonly type?: unknown;
    readonly [key: string]: unknown;
}
/**
 * Tracks per-session live facts from session events and agent status.
 * The active session is the one whose latest event arrived most recently.
 */
export declare class SessionPhaseTracker {
    private readonly sessions;
    private activeSession;
    private readonly clock;
    constructor(options?: {
        readonly now?: () => number;
    });
    /** Feed one observed session event. */
    onSessionEvent(session: object, event: ObservedSessionEvent): void;
    /** Feed one cordis agent status transition. */
    onAgentStatus(session: object, status: string): void;
    /** Drop one session's state (session/disposed). */
    disposeSession(session: object): void;
    /** Drop every tracked session (plugin unload). */
    clear(): void;
    /** The session whose event arrived most recently, with its live facts. */
    active(): {
        readonly session: object;
        readonly state: SessionState;
    } | undefined;
    /** Snapshot one session's facts, if tracked. */
    stateOf(session: object): SessionState | undefined;
    /** Number of tracked sessions (diagnostics/tests). */
    size(): number;
    /** Get or create + bound the tracked map. */
    private track;
    /** Project the mutable tracker record into the public read-only shape. */
    private toState;
}
/**
 * Derive the rotation phase from a running turn's elapsed time. The original
 * web plugin used the same three windows: thinking before its clock appears,
 * running once the elapsed clock is shown, long when it exceeds the threshold.
 */
export declare function phaseOf(turnStartedAt: number, now: number, clock: PhaseClockConfig): Phase;
/**
 * Whether a session belongs to a subagent child. dsh-session stamps
 * `header.origin = 'subagent'` (and a delegation depth) on subagent sessions;
 * the field is read structurally because this plugin does not depend on the
 * session package's runtime.
 */
export declare function isSubagentSession(session: object): boolean;
