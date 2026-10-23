/** How many sessions the tracker retains state for. */
const MAX_SESSIONS = 16;
/** Create an empty tracked session. */
function emptySession() {
    return {
        running: false,
        turn: 0,
        turnStartedAt: 0,
        firstTokenAt: 0,
        tools: new Map(),
        retry: 0,
        retryMax: undefined,
        pending: new Set(),
        firstTurn: false,
    };
}
/** String field access that never throws on hostile objects. */
function text(value) {
    return typeof value === 'string' && value !== '' ? value : undefined;
}
/** Number field access that never throws on hostile objects. */
function num(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
/**
 * Tracks per-session live facts from session events and agent status.
 * The active session is the one whose latest event arrived most recently.
 */
export class SessionPhaseTracker {
    sessions = new Map();
    activeSession;
    clock;
    constructor(options = {}) {
        this.clock = options.now ?? Date.now;
    }
    /** Feed one observed session event. */
    onSessionEvent(session, event) {
        if (session === null || typeof session !== 'object')
            return;
        const type = text(event?.type);
        if (type === undefined)
            return;
        const tracked = this.track(session);
        switch (type) {
            case 'turn/start': {
                tracked.running = true;
                tracked.turn = num(event.turn) ?? tracked.turn + 1;
                tracked.turnStartedAt = this.clock();
                tracked.firstTokenAt = 0;
                tracked.tools.clear();
                tracked.retry = 0;
                tracked.retryMax = undefined;
                tracked.pending.clear();
                tracked.firstTurn = tracked.turn === 1;
                break;
            }
            case 'turn/end': {
                tracked.running = false;
                tracked.tools.clear();
                break;
            }
            case 'tool/call': {
                const callId = text(event.callId) ?? text(event.id) ?? 'call-' + tracked.tools.size;
                tracked.tools.set(callId, text(event.name) ?? 'tool');
                break;
            }
            case 'tool/result': {
                const callId = text(event.callId);
                if (callId !== undefined)
                    tracked.tools.delete(callId);
                else
                    tracked.tools.clear();
                break;
            }
            case 'llm/retry': {
                tracked.retry = num(event.retry) ?? tracked.retry;
                tracked.retryMax = num(event.maxRetries) ?? tracked.retryMax;
                break;
            }
            case 'llm/retry-started': {
                tracked.retry = num(event.retry) ?? tracked.retry;
                break;
            }
            case 'approval/asked': {
                const id = text(event.id);
                if (id !== undefined)
                    tracked.pending.add(id);
                break;
            }
            case 'approval/decided': {
                const id = text(event.id);
                if (id !== undefined)
                    tracked.pending.delete(id);
                break;
            }
            default:
                break;
        }
        // A subagent's session must never take over the line the user is looking
        // at: the TUI renders the main conversation, and subagent output is
        // summarized into its transcript. Keep tracking it (cheap) but do not make
        // it the active session.
        if (!isSubagentSession(session))
            this.activeSession = session;
    }
    /** Feed one cordis agent status transition. */
    onAgentStatus(session, status) {
        if (session === null || typeof session !== 'object')
            return;
        const tracked = this.track(session);
        if (status === 'idle') {
            // A session that goes idle while a turn is still marked open (crash,
            // cancellation) must not leave the line stuck forever.
            tracked.running = false;
            tracked.tools.clear();
            tracked.pending.clear();
        }
        if (!isSubagentSession(session))
            this.activeSession = session;
    }
    /** Drop one session's state (session/disposed). */
    disposeSession(session) {
        this.sessions.delete(session);
        if (this.activeSession === session)
            this.activeSession = undefined;
    }
    /** Drop every tracked session (plugin unload). */
    clear() {
        this.sessions.clear();
        this.activeSession = undefined;
    }
    /** The session whose event arrived most recently, with its live facts. */
    active() {
        const session = this.activeSession;
        if (session === undefined)
            return undefined;
        const tracked = this.sessions.get(session);
        if (tracked === undefined)
            return undefined;
        return { session, state: this.toState(tracked) };
    }
    /** Snapshot one session's facts, if tracked. */
    stateOf(session) {
        const tracked = this.sessions.get(session);
        return tracked === undefined ? undefined : this.toState(tracked);
    }
    /** Number of tracked sessions (diagnostics/tests). */
    size() {
        return this.sessions.size;
    }
    /** Get or create + bound the tracked map. */
    track(session) {
        let tracked = this.sessions.get(session);
        if (tracked !== undefined)
            return tracked;
        if (this.sessions.size >= MAX_SESSIONS) {
            const oldest = this.sessions.keys().next();
            if (!oldest.done)
                this.sessions.delete(oldest.value);
        }
        tracked = emptySession();
        this.sessions.set(session, tracked);
        return tracked;
    }
    /** Project the mutable tracker record into the public read-only shape. */
    toState(tracked) {
        return {
            running: tracked.running,
            turnStartedAt: tracked.turnStartedAt,
            firstTokenAt: tracked.firstTokenAt,
            tools: [...tracked.tools.values()],
            retry: tracked.retry,
            ...(tracked.retryMax === undefined ? {} : { retryMax: tracked.retryMax }),
            pending: tracked.pending.size,
            firstTurn: tracked.firstTurn,
        };
    }
}
/**
 * Derive the rotation phase from a running turn's elapsed time. The original
 * web plugin used the same three windows: thinking before its clock appears,
 * running once the elapsed clock is shown, long when it exceeds the threshold.
 */
export function phaseOf(turnStartedAt, now, clock) {
    const elapsed = Math.max(0, now - turnStartedAt);
    if (elapsed < clock.thinkingMs)
        return 'thinking';
    if (elapsed < clock.longAfterMs)
        return 'running';
    return 'long';
}
/**
 * Whether a session belongs to a subagent child. dsh-session stamps
 * `header.origin = 'subagent'` (and a delegation depth) on subagent sessions;
 * the field is read structurally because this plugin does not depend on the
 * session package's runtime.
 */
export function isSubagentSession(session) {
    try {
        const header = session.header;
        if (header === null || typeof header !== 'object')
            return false;
        const record = header;
        if (record.origin === 'subagent')
            return true;
        return typeof record.delegationDepth === 'number' && record.delegationDepth > 0;
    }
    catch {
        return false;
    }
}
