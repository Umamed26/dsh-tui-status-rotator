/**
 * dsh-TUI host seam probing.
 *
 * dsh-TUI's plugin seams are optional rows on the cordis composition: a stale
 * profile patch, an older host build, or a Web front door simply does not
 * mount them. Every seam therefore has to be **soft-probed** with
 * `ctx.get(name, false)` (#183 discipline): a missing seam degrades one
 * feature and produces a diagnostic, it never throws and never prevents boot.
 *
 * This module owns only the probe + the safe-cleanup helpers. It imports
 * nothing from dsh-TUI: the seam contracts are the structural copies in
 * `../types.js`, and the identity passed to status/settings registrations is
 * the plugin's own cordis Context (the host's effect ledger attributes the
 * registration from it).
 *
 * @module dsh-tui-status-rotator/tui/host
 */
import type {
  CommandsService,
  DiagnosticsSink,
  TuiPluginHostService,
  TuiPromptService,
  TuiSettingsSectionsService,
  TuiStatusService,
} from '../types.js'

/** One soft-probe diagnostic: a seam that is missing or has the wrong shape. */
export interface HostDiagnostic {
  /** Stable diagnostic code (shown by /status-rotator status). */
  readonly code: string
  /** Human-readable description naming the degraded feature. */
  readonly message: string
}

/**
 * Structural slice of the cordis Context this module needs. Every member is
 * optional so a fake/degraded context probes cleanly instead of throwing.
 * `fiber.entry.options.id` is the Loader entry id of the profile row (also the
 * settings namespace the row's Config owner registers); the TUI's own plugin
 * matrix resolves its settings namespace the same way.
 */
export interface StructuralContext {
  get(name: string, strict?: boolean): unknown
  logger?: { warn(message: string): void }
  fiber?: { entry?: { options?: { id?: string } } }
}

/** Services this plugin consumes, resolved from the host once at boot. */
export interface HostPorts {
  /** Seam 11: tuiStatus (keyed status line, rich views, footer fields). */
  status?: TuiStatusService
  /** Seam 6: tuiSettingsSections (declarative /settings section). */
  settingsSections?: TuiSettingsSectionsService
  /** dsh-commands registry (direct, unattributed registrations). */
  commands?: CommandsService
  /** tuiPluginHost (mediated command registration with C-041 attribution). */
  pluginHost?: TuiPluginHostService
  /** Official DSH prompt slot service (dsh-TUI itself does not mount it). */
  prompt?: TuiPromptService
  /** Profile row id: settings namespace + fallback attribution label. */
  readonly entryId: string
}

/** Result of probing every seam once at activation time. */
export interface HostProbeResult {
  readonly ports: HostPorts
  readonly diagnostics: readonly HostDiagnostic[]
}

/** Short single-line error text for diagnostics (never throws). */
function describe(error: unknown): string {
  try {
    if (error instanceof Error) return error.message.replace(/\s+/gu, ' ').slice(0, 200)
    return String(error).replace(/\s+/gu, ' ').slice(0, 200)
  } catch {
    return 'unknown error'
  }
}

/**
 * Read the Loader entry id of this plugin row: the settings namespace the row
 * owns. Falls back to the documented default when the context has no Loader
 * entry (bare compositions, tests, embedding).
 */
export function resolveEntryId(ctx: StructuralContext | undefined, fallback: string): string {
  try {
    const id = ctx?.fiber?.entry?.options?.id
    if (typeof id === 'string' && id.trim() !== '') return id.trim()
  } catch {
    // Degraded context (proxies/getters may throw): keep the fallback.
  }
  const normalizedFallback = typeof fallback === 'string' && fallback.trim() !== '' ? fallback.trim() : 'status-rotator'
  return normalizedFallback
}

/** Whether `value` exposes `name` as a callable method (never throws). */
function hasMethod(value: unknown, name: string): boolean {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false
  try {
    return typeof (value as Record<string, unknown>)[name] === 'function'
  } catch {
    return false
  }
}

/**
 * Probe all host seams once. Absent or malformed seams become diagnostics; the
 * returned ports object simply omits them, so callers degrade feature by
 * feature. Never throws, even for a hostile/degraded context.
 */
export function probeHostPorts(ctx: StructuralContext, fallbackEntryId: string): HostProbeResult {
  const diagnostics: HostDiagnostic[] = []
  const entryId = resolveEntryId(ctx, fallbackEntryId)
  const ports: HostPorts = { entryId }
  const push = (code: string, message: string): void => {
    diagnostics.push({ code, message })
  }
  const canProbe = ctx !== null && ctx !== undefined && typeof ctx === 'object' && typeof (ctx as { get?: unknown }).get === 'function'
  if (!canProbe) {
    push('host.no-context', 'the plugin context has no ctx.get(); every dsh-TUI seam is unavailable and the plugin runs as a no-op')
  }
  const read = (name: string): unknown => {
    if (!canProbe) return undefined
    try {
      return ctx.get(name, false)
    } catch (error) {
      push('host.probe-failed', 'ctx.get("' + name + '", false) threw: ' + describe(error))
      return undefined
    }
  }

  // Seam 11 - keyed status line + bounded rich views.
  const rawStatus = read('tuiStatus')
  if (rawStatus === undefined) {
    push('host.missing-tuiStatus', 'tuiStatus is not mounted (stale profile patch or non-TUI host); the rotating status line stays hidden')
  } else if (!hasMethod(rawStatus, 'set') && !hasMethod(rawStatus, 'registerView')) {
    push('host.invalid-tuiStatus', 'tuiStatus is present but exposes neither set() nor registerView(); the rotating status line stays hidden')
  } else {
    ports.status = rawStatus as TuiStatusService
    if (!hasMethod(rawStatus, 'registerView')) {
      push('host.no-registerView', 'tuiStatus.registerView is missing on this host; the rotating line downgrades to plain tuiStatus.set text (no typewriter/gradient)')
    }
  }

  // Seam 6 - declarative /settings section.
  const rawSettings = read('tuiSettingsSections')
  if (rawSettings === undefined) {
    push('host.missing-tuiSettingsSections', 'tuiSettingsSections is not mounted; the /settings section is unavailable (edit the profile patch or ~/.dsh/settings.yaml instead)')
  } else if (!hasMethod(rawSettings, 'register')) {
    push('host.invalid-tuiSettingsSections', 'tuiSettingsSections is present but has no register(); the /settings section is unavailable')
  } else {
    ports.settingsSections = rawSettings as TuiSettingsSectionsService
  }

  // dsh-commands registry (direct / unattributed fallback).
  const rawCommands = read('commands')
  if (rawCommands === undefined) {
    push('host.missing-commands', 'the commands service is not mounted; the /status-rotator command is unavailable')
  } else if (!hasMethod(rawCommands, 'register')) {
    push('host.invalid-commands', 'the commands service is present but has no register(); the /status-rotator command is unavailable')
  } else {
    ports.commands = rawCommands as CommandsService
  }

  // tuiPluginHost - mediated command registration (C-041 attribution).
  const rawPluginHost = read('tuiPluginHost')
  if (rawPluginHost === undefined) {
    push('host.missing-tuiPluginHost', 'tuiPluginHost is not mounted; /status-rotator falls back to the unattributed commands.register path')
  } else if (!hasMethod(rawPluginHost, 'registerCommand')) {
    push('host.invalid-tuiPluginHost', 'tuiPluginHost is present but has no registerCommand(); /status-rotator falls back to the unattributed commands.register path')
  } else {
    ports.pluginHost = rawPluginHost as TuiPluginHostService
  }

  // Official DSH prompt slot. dsh-TUI does not mount this seam: absence is the
  // documented normal case, not a degradation of the dsh-TUI surface.
  const rawPrompt = read('tuiPrompt')
  if (rawPrompt === undefined) {
    push('host.missing-tuiPrompt', 'tuiPrompt is not mounted (dsh-TUI does not provide it); the optional official-TUI prompt slot is skipped')
  } else if (!hasMethod(rawPrompt, 'register')) {
    push('host.invalid-tuiPrompt', 'tuiPrompt is present but has no register(); the optional official-TUI prompt slot is skipped')
  } else {
    ports.prompt = rawPrompt as TuiPromptService
  }

  return { ports, diagnostics }
}

/**
 * Invoke one cleanup handle without ever throwing: a disposer that fails must
 * not abort the rest of plugin teardown. Returns whether it ran.
 */
export function safeDispose(dispose: unknown, diagnostics: DiagnosticsSink, code = 'cleanup.failed'): boolean {
  if (typeof dispose !== 'function') return false
  try {
    ;(dispose as () => void)()
    return true
  } catch (error) {
    report(diagnostics, code, 'cleanup callback threw: ' + describe(error))
    return false
  }
}

/** Run every cleanup handle in reverse registration order, isolating failures. */
export function disposeAll(disposers: readonly unknown[], diagnostics: DiagnosticsSink, code = 'cleanup.failed'): void {
  for (let index = disposers.length - 1; index >= 0; index -= 1) {
    safeDispose(disposers[index], diagnostics, code)
  }
}

/** Report a diagnostic without letting a broken sink break teardown. */
function report(diagnostics: DiagnosticsSink, code: string, message: string): void {
  try {
    diagnostics.warn(code, message)
  } catch {
    // A diagnostics sink must never be able to break cleanup.
  }
}