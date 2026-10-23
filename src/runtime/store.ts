/**
 * Subscribable frame store shared by the runtime controller and the rich
 * status view component. The controller is the single writer; the component
 * only reads snapshots and subscribes (the shape tuiStatus.registerView
 * components are expected to consume, since the host injects no data props).
 *
 * @module dsh-tui-status-rotator/runtime/store
 */
import type { ViewFrame, ViewStoreLike } from '../types.js'

/** The invisible frame: nothing rendered, revision still advances on change. */
export const HIDDEN_FRAME: ViewFrame = Object.freeze({
  revision: 0,
  visible: false,
  phase: 'thinking' as const,
  lang: 'zh' as const,
  text: '',
  startedAt: 0,
  typeSpeedMs: 0,
})

/** A frame without its revision (the store stamps it). */
export type FrameInput = Omit<ViewFrame, 'revision'>

/** Minimal external store for view frames. */
export class ViewFrameStore implements ViewStoreLike {
  private frame: ViewFrame = HIDDEN_FRAME
  private readonly listeners = new Set<() => void>()

  get snapshot(): ViewFrame {
    return this.frame
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Publish a new frame. No-ops (and does not notify) on a deep-equal frame. */
  publish(input: FrameInput): void {
    if (sameFrame(this.frame, input)) return
    this.frame = Object.freeze({ ...input, revision: this.frame.revision + 1 })
    this.emit()
  }

  /** Hide the line (idempotent). */
  hide(): void {
    if (!this.frame.visible) return
    this.publish({ ...HIDDEN_FRAME, phase: this.frame.phase, lang: this.frame.lang })
  }

  private emit(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch {
        // A broken subscriber must not take down the others.
      }
    }
  }
}

/** Compare frames ignoring the revision stamp. */
function sameFrame(current: ViewFrame, next: FrameInput): boolean {
  if (current.visible !== next.visible) return false
  if (!next.visible) return true
  if (current.phase !== next.phase || current.lang !== next.lang) return false
  if (current.text !== next.text) return false
  if (current.startedAt !== next.startedAt) return false
  if (current.typeSpeedMs !== next.typeSpeedMs) return false
  const a = current.gradient
  const b = next.gradient
  if (a === undefined || b === undefined) return a === b
  return a.mode === b.mode
    && a.direction === b.direction
    && a.speedMs === b.speedMs
    && a.palette.length === b.palette.length
    && a.palette.every((color, index) => color === b.palette[index])
}
