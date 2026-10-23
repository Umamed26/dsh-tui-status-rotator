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
import type { Diagnostic, DiagnosticsSink } from '../types.js'

/** How many diagnostics are retained for the status command. */
const MAX_DIAGNOSTICS = 40

/** Bounded, deduplicated diagnostic sink. */
export class RuntimeDiagnostics implements DiagnosticsSink {
  private readonly entries: Diagnostic[] = []
  private readonly seen = new Set<string>()

  constructor(
    private readonly log: (code: string, message: string) => void = () => undefined,
    private readonly clock: () => number = Date.now,
  ) {}

  warn(code: string, message: string): void {
    const key = code + '\u0000' + message
    if (this.seen.has(key)) return
    this.seen.add(key)
    if (this.seen.size > 400) this.seen.clear()
    this.entries.push({ code, message, at: this.clock() })
    if (this.entries.length > MAX_DIAGNOSTICS) this.entries.shift()
    try {
      this.log(code, message)
    } catch {
      // Logging must never break the plugin.
    }
  }

  list(): readonly Diagnostic[] {
    return this.entries.slice()
  }

  clear(): void {
    this.entries.length = 0
    this.seen.clear()
  }
}
