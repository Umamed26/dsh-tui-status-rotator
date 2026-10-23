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
import type { DiagnosticsSink, TuiStatusService } from '../types.js'
import type { HostPorts } from './host.js'

/** Key shared with the rich status view (the host keeps one namespace). */
export const PLAIN_STATUS_KEY = 'status-rotator'

/** Host text contributions are capped at 200 cells; longer text is trimmed here. */
const MAX_TEXT_CELLS = 200

/** The degraded status surface the controller drives instead of the rich view. */
export interface PlainStatusBridge {
  /** Write the current line; `undefined`/`''` clears the contribution. */
  update(text: string | undefined): void
  /** Release the contribution (plugin unload / rich view became available). */
  dispose(): void
}

/**
 * Create the plain-text bridge, or `undefined` when `tuiStatus.set` is not
 * available (the caller then reports "no status seam at all"). Never throws.
 */
export function createPlainStatusBridge(ports: HostPorts, diagnostics: DiagnosticsSink): PlainStatusBridge | undefined {
  const status: TuiStatusService | undefined = ports.status
  if (status === undefined || status === null || typeof status.set !== 'function') {
    diagnostics.warn('status.plain-unavailable', 'tuiStatus.set is unavailable; the rotating line stays hidden')
    return undefined
  }

  let disposer: (() => void) | undefined
  let disposed = false

  /** Release the previous write's token (if the host handed one back). */
  const release = (): void => {
    const current = disposer
    disposer = undefined
    if (typeof current !== 'function') return
    try {
      current()
    } catch {
      // A stale token disposer failing must not break the next update.
    }
  }

  return {
    update(text: string | undefined): void {
      if (disposed) return
      const value = typeof text === 'string' ? normalizeText(text) : undefined
      release()
      try {
        const result: unknown = status.set(PLAIN_STATUS_KEY, value)
        if (typeof result === 'function') disposer = result as () => void
      } catch (error) {
        diagnostics.warn('status.plain-failed', 'tuiStatus.set failed: ' + describe(error))
      }
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      release()
      try {
        status.set(PLAIN_STATUS_KEY, undefined)
      } catch {
        // Clearing on teardown is best effort; the host also drops plugin
        // contributions on activation dispose when `ctx.effect` is honored.
      }
    },
  }
}

/** Trim the line to the host's cell budget and clear whitespace-only text. */
function normalizeText(text: string): string | undefined {
  const trimmed = text.replace(/\s+/gu, ' ').trim()
  if (trimmed === '') return undefined
  if (trimmed.length <= MAX_TEXT_CELLS) return trimmed
  return trimmed.slice(0, MAX_TEXT_CELLS - 1) + ELLIPSIS
}

const ELLIPSIS = '…'

/** Short single-line error text (never throws). */
function describe(error: unknown): string {
  try {
    if (error instanceof Error) return error.message.replace(/\s+/gu, ' ').slice(0, 200)
    return String(error).replace(/\s+/gu, ' ').slice(0, 200)
  } catch {
    return 'unknown error'
  }
}
