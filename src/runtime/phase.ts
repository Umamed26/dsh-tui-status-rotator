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
import type { Phase, PhaseClockConfig, SessionState } from '../types.js'

/** How many sessions the tracker retains state for. */
const MAX_SESSIONS = 16

/** Defensive view of one session event (external data, never trusted). */
export interface ObservedSessionEvent {
  readonly type?: unknown
  readonly [key: string]: unknown
}

/** One tracked session's live facts. */
interface TrackedSession {
  running: boolean
  turn: number
  turnStartedAt: number
  firstTokenAt: number
  tools: Map<string, string>
  retry: number
  retryMax?: number
  pending: Set<string>
  firstTurn: boolean
}

/** Create an empty tracked session. */
function emptySession(): TrackedSession {
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
  }
}

/** String field access that never throws on hostile objects. */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** Number field access that never throws on hostile objects. */
function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * Tracks per-session live facts from session events and agent status.
 * The active session is the one whose latest event arrived most recently.
 */
export class SessionPhaseTracker {
  private readonly sessions = new Map<object, TrackedSession>()
  private activeSession: object | undefined
  private readonly clock: () => number

  constructor(options: { readonly now?: () => number } = {}) {
    this.clock = options.now ?? Date.now
  }

  /** Feed one observed session event. */
  onSessionEvent(session: object, event: ObservedSessionEvent): void {
    if (session === null || typeof session !== 'object') return
    const type = text(event?.type)
    if (type === undefined) return
    const tracked = this.track(session)
    switch (type) {
      case 'turn/start': {
        tracked.running = true
        tracked.turn = num(event.turn) ?? tracked.turn + 1
        tracked.turnStartedAt = this.clock()
        tracked.firstTokenAt = 0
        tracked.tools.clear()
        tracked.retry = 0
        tracked.retryMax = undefined
        tracked.pending.clear()
        tracked.firstTurn = tracked.turn === 1
        break
      }
      case 'turn/end': {
        tracked.running = false
        tracked.tools.clear()
        break
      }
      case 'tool/call': {
        const callId = text(event.callId) ?? text(event.id) ?? 'call-' + tracked.tools.size
        tracked.tools.set(callId, text(event.name) ?? 'tool')
        break
      }
      case 'tool/result': {
        const callId = text(event.callId)
        if (callId !== undefined) tracked.tools.delete(callId)
        else tracked.tools.clear()
        break
      }
      case 'llm/retry': {
        tracked.retry = num(event.retry) ?? tracked.retry
        tracked.retryMax = num(event.maxRetries) ?? tracked.retryMax
        break
      }
      case 'llm/retry-started': {
        tracked.retry = num(event.retry) ?? tracked.retry
        break
      }
      case 'approval/asked': {
        const id = text(event.id)
        if (id !== undefined) tracked.pending.add(id)
        break
      }
      case 'approval/decided': {
        const id = text(event.id)
        if (id !== undefined) tracked.pending.delete(id)
        break
      }
      default:
        break
    }
    // A subagent's session must never take over the line the user is looking
    // at: the TUI renders the main conversation, and subagent output is
    // summarized into its transcript. Keep tracking it (cheap) but do not make
    // it the active session.
    if (!isSubagentSession(session)) this.activeSession = session
  }

  /** Feed one cordis agent status transition. */
  onAgentStatus(session: object, status: string): void {
    if (session === null || typeof session !== 'object') return
    const tracked = this.track(session)
    if (status === 'idle') {
      // A session that goes idle while a turn is still marked open (crash,
      // cancellation) must not leave the line stuck forever.
      tracked.running = false
      tracked.tools.clear()
      tracked.pending.clear()
    }
    if (!isSubagentSession(session)) this.activeSession = session
  }

  /** Drop one session's state (session/disposed). */
  disposeSession(session: object): void {
    this.sessions.delete(session)
    if (this.activeSession === session) this.activeSession = undefined
  }

  /** Drop every tracked session (plugin unload). */
  clear(): void {
    this.sessions.clear()
    this.activeSession = undefined
  }

  /** The session whose event arrived most recently, with its live facts. */
  active(): { readonly session: object; readonly state: SessionState } | undefined {
    const session = this.activeSession
    if (session === undefined) return undefined
    const tracked = this.sessions.get(session)
    if (tracked === undefined) return undefined
    return { session, state: this.toState(tracked) }
  }

  /** Snapshot one session's facts, if tracked. */
  stateOf(session: object): SessionState | undefined {
    const tracked = this.sessions.get(session)
    return tracked === undefined ? undefined : this.toState(tracked)
  }

  /** Number of tracked sessions (diagnostics/tests). */
  size(): number {
    return this.sessions.size
  }

  /** Get or create + bound the tracked map. */
  private track(session: object): TrackedSession {
    let tracked = this.sessions.get(session)
    if (tracked !== undefined) return tracked
    if (this.sessions.size >= MAX_SESSIONS) {
      const oldest = this.sessions.keys().next()
      if (!oldest.done) this.sessions.delete(oldest.value)
    }
    tracked = emptySession()
    this.sessions.set(session, tracked)
    return tracked
  }

  /** Project the mutable tracker record into the public read-only shape. */
  private toState(tracked: TrackedSession): SessionState {
    return {
      running: tracked.running,
      turnStartedAt: tracked.turnStartedAt,
      firstTokenAt: tracked.firstTokenAt,
      tools: [...tracked.tools.values()],
      retry: tracked.retry,
      ...(tracked.retryMax === undefined ? {} : { retryMax: tracked.retryMax }),
      pending: tracked.pending.size,
      firstTurn: tracked.firstTurn,
    }
  }
}

/**
 * Derive the rotation phase from a running turn's elapsed time. The original
 * web plugin used the same three windows: thinking before its clock appears,
 * running once the elapsed clock is shown, long when it exceeds the threshold.
 */
export function phaseOf(turnStartedAt: number, now: number, clock: PhaseClockConfig): Phase {
  const elapsed = Math.max(0, now - turnStartedAt)
  if (elapsed < clock.thinkingMs) return 'thinking'
  if (elapsed < clock.longAfterMs) return 'running'
  return 'long'
}

/**
 * Whether a session belongs to a subagent child. dsh-session stamps
 * `header.origin = 'subagent'` (and a delegation depth) on subagent sessions;
 * the field is read structurally because this plugin does not depend on the
 * session package's runtime.
 */
export function isSubagentSession(session: object): boolean {
  try {
    const header = (session as { header?: unknown }).header
    if (header === null || typeof header !== 'object') return false
    const record = header as { origin?: unknown; delegationDepth?: unknown }
    if (record.origin === 'subagent') return true
    return typeof record.delegationDepth === 'number' && record.delegationDepth > 0
  } catch {
    return false
  }
}
