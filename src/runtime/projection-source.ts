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
import type { SessionState } from '../types.js'
import { isSubagentSession } from './phase.js'

/** The projection key the host working-activity plugin publishes. */
export const ACTIVITY_PROJECTION_KEY = 'workingActivity'

/** How many sessions the feed retains state for. */
const MAX_SESSIONS = 16

/** Structural slice of the host SessionProjectionRegistry this module uses. */
export interface ProjectionRegistryLike {
  onChanged(listener: (session: object, key: string, value: unknown, seq: number) => void): () => void
}

/** One tracked session's projection-derived facts. */
interface TrackedActivity {
  running: boolean
  phase: string
  turnStartedAt: number
  phaseStartedAt: number
  tools: string[]
  turnCount: number
  firstTurn: boolean
  label?: string
  detail?: string
  updatedAt: number
}

/** Result of one read. */
export interface ProjectionActivityState {
  readonly session: object
  readonly state: SessionState
}

/**
 * Derives live session facts from the `workingActivity` projection change
 * feed. Attach once with the host registry; `stop()` unsubscribes.
 */
export class ProjectionActivityFeed {
  private readonly sessions = new Map<object, TrackedActivity>()
  private activeSession: object | undefined
  private unsubscribe: (() => void) | undefined
  private lastError: string | undefined
  private changeCounter = 0
  private readonly onChange: ((info: { readonly phase: string; readonly running: boolean }) => void) | undefined

  /** @param options - optional change hook used for debug counters/telemetry. */
  constructor(options: { readonly onChange?: (info: { readonly phase: string; readonly running: boolean }) => void } = {}) {
    this.onChange = options.onChange
  }

  /** Number of workingActivity changes folded so far (diagnostics). */
  changeCount(): number {
    return this.changeCounter
  }

  /** Attach to the host registry; returns false when the registry is unusable. */
  attach(registry: ProjectionRegistryLike): boolean {
    if (this.unsubscribe !== undefined) return true
    try {
      this.unsubscribe = registry.onChanged((session, key, value) => {
        if (key !== ACTIVITY_PROJECTION_KEY) return
        this.onActivityChange(session, value)
      })
      return true
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
      return false
    }
  }

  /** Detach from the registry (plugin unload). */
  stop(): void {
    const dispose = this.unsubscribe
    this.unsubscribe = undefined
    try {
      dispose?.()
    } catch {
      // A broken disposer must not break unload.
    }
  }

  /** Whether the feed is attached. */
  attached(): boolean {
    return this.unsubscribe !== undefined
  }

  /** Last attach failure, for diagnostics. */
  error(): string | undefined {
    return this.lastError
  }

  /** The session whose activity changed most recently, with derived facts. */
  active(): ProjectionActivityState | undefined {
    const session = this.activeSession
    if (session === undefined) return undefined
    const tracked = this.sessions.get(session)
    if (tracked === undefined) return undefined
    return { session, state: this.toState(tracked) }
  }

  /** Number of tracked sessions (diagnostics/tests). */
  size(): number {
    return this.sessions.size
  }

  /** Fold one `workingActivity` change into the tracked map. */
  private onActivityChange(session: object, value: unknown): void {
    if (session === null || typeof session !== 'object' || value === null || typeof value !== 'object') return
    const view = value as {
      phase?: unknown
      turnStartedAt?: unknown
      phaseStartedAt?: unknown
      updatedAt?: unknown
      label?: unknown
      detail?: unknown
    }
    const phase = typeof view.phase === 'string' ? view.phase : 'idle'
    const tracked = this.track(session)
    const running = phase !== 'idle' && phase !== 'done'
    this.changeCounter += 1
    try {
      this.onChange?.({ phase, running })
    } catch {
      // Debug/telemetry hooks must never break the fold.
    }
    if (running && !tracked.running) tracked.turnCount += 1
    tracked.running = running
    tracked.phase = phase
    if (typeof view.turnStartedAt === 'number' && Number.isFinite(view.turnStartedAt)) {
      tracked.turnStartedAt = view.turnStartedAt
    }
    if (typeof view.phaseStartedAt === 'number' && Number.isFinite(view.phaseStartedAt)) {
      tracked.phaseStartedAt = view.phaseStartedAt
    }
    if (typeof view.updatedAt === 'number' && Number.isFinite(view.updatedAt)) {
      tracked.updatedAt = view.updatedAt
    }
    tracked.firstTurn = tracked.turnCount <= 1
    tracked.label = typeof view.label === 'string' && view.label !== '' ? view.label : undefined
    tracked.detail = typeof view.detail === 'string' && view.detail !== '' ? view.detail : undefined
    // The tool label doubles as a coarse tool name for the {tools} placeholder
    // in hosts where the projection is the only source (the view carries no
    // exact tool-name list).
    tracked.tools = tracked.label === undefined ? [] : [tracked.label]
    if (!isSubagentSession(session)) this.activeSession = session
  }

  /** Get or create a bounded tracked record. */
  private track(session: object): TrackedActivity {
    const existing = this.sessions.get(session)
    if (existing !== undefined) return existing
    if (this.sessions.size >= MAX_SESSIONS) {
      const oldest = this.sessions.keys().next()
      if (!oldest.done) this.sessions.delete(oldest.value)
    }
    const fresh: TrackedActivity = {
      running: false,
      phase: 'idle',
      turnStartedAt: 0,
      phaseStartedAt: 0,
      tools: [],
      turnCount: 0,
      firstTurn: true,
      updatedAt: 0,
    }
    this.sessions.set(session, fresh)
    return fresh
  }

  /** Project into the public SessionState shape. */
  private toState(tracked: TrackedActivity): SessionState {
    return {
      running: tracked.running,
      turnStartedAt: tracked.turnStartedAt,
      firstTokenAt: 0,
      tools: tracked.tools.slice(),
      retry: 0,
      pending: 0,
      firstTurn: tracked.firstTurn,
    }
  }
}

