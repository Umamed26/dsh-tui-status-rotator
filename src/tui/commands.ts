/**
 * `/status-rotator` command (dsh-commands).
 *
 * Subcommands: `next` | `on` | `off` | `status` (no argument = status).
 * Command registration prefers the **mediated** surface
 * `tuiPluginHost.registerCommand(ctx, definition)` (C-041 attribution: the
 * host stamps the verified component identity so per-plugin `commands.invoke`
 * denies apply). When that surface is absent OR rejects the registration, the
 * plugin falls back to the direct `commands.register(definition)` seam: the
 * command keeps working, loses attribution, and the degradation is reported
 * through the diagnostics sink (visible in `/status-rotator status`).
 *
 * Handler input: dsh-commands invokes handlers with its invocation object
 * (`{ commandId, agent, rawInput, attachments, signal }`); structural hosts
 * may pass the raw string. Both shapes are accepted.
 *
 * @module dsh-tui-status-rotator/tui/commands
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { detectLanguage } from '../config.js'
import { t } from '../locale.js'
import type { CommandDefinition, CommandResult, Diagnostic, DiagnosticsSink, Lang } from '../types.js'
import type { HostPorts, StructuralContext } from './host.js'

/** Registered command name (without the leading slash). */
export const STATUS_COMMAND_NAME = 'status-rotator'

/** What the command drives; supplied by the runtime controller in index.ts. */
export interface StatusCommandDeps {
  /** Force the next phrase (controller.next()). */
  next(): void
  /** Enable/disable the line for this run (controller.setEnabled()). */
  setEnabled(on: boolean): void
  /** Multi-line status snapshot rendered by the command surface. */
  statusText(): string
  /** Whether the line is currently enabled. */
  enabled(): boolean
  /** UI language for the command messages (resolved by the runtime). */
  lang?(): Lang
  /** Diagnostics sink for registration/execution degradation. */
  diagnostics?: DiagnosticsSink
}

/** A dsh-commands invocation object (structural, untrusted). */
interface HostCommandInvocationLike {
  readonly rawInput?: unknown
}

/**
 * Register the command. Returns the unregister disposer, or `undefined` when no
 * registration surface accepted the definition (diagnostic emitted, no throw).
 */
export function registerStatusCommand(
  ctx: StructuralContext,
  ports: HostPorts,
  deps: StatusCommandDeps,
): (() => void) | undefined {
  const diagnostics = deps.diagnostics ?? createLoggerSink(ctx)
  const definition: CommandDefinition = {
    name: STATUS_COMMAND_NAME,
    description: t(resolveLang(deps), 'cmd.description'),
    handler: (input: unknown): CommandResult => executeCommand(input, deps),
  }

  // 1) Mediated registration: C-041 attribution + the host's grant checkpoint.
  const pluginHost = ports.pluginHost
  if (pluginHost !== undefined && pluginHost !== null && typeof pluginHost.registerCommand === 'function') {
    try {
      const dispose = pluginHost.registerCommand(ctx, definition)
      if (typeof dispose === 'function') return safeDisposer(dispose, diagnostics, 'command.dispose-failed')
      diagnostics.warn('command.register-no-disposer', 'tuiPluginHost.registerCommand returned no disposer; trying the direct commands seam')
    } catch (error) {
      // Typical reasons: commands service not mounted on this ctx, the
      // manifest contribution id does not bind to the command name, or a
      // duplicate registration. Falling back keeps the command usable and
      // leaves the degraded attribution visible.
      diagnostics.warn(
        'command.mediated-failed',
        'tuiPluginHost.registerCommand failed (' + describe(error) + '); falling back to direct commands.register (command attribution is lost)',
      )
    }
  }

  // 2) Direct registration (documented C-070 boundary: unattributed).
  const commands = ports.commands
  if (commands !== undefined && commands !== null && typeof commands.register === 'function') {
    try {
      const dispose = commands.register(definition)
      if (typeof dispose === 'function') return safeDisposer(dispose, diagnostics, 'command.dispose-failed')
      diagnostics.warn('command.register-no-disposer', 'commands.register returned no disposer; the command is treated as unregistered')
    } catch (error) {
      diagnostics.warn('command.register-failed', 'commands.register failed: ' + describe(error))
    }
  }

  diagnostics.warn('command.unavailable', 'no command registration surface accepted /status-rotator; the command is unavailable')
  return undefined
}

/** Execute one invocation (string tail or dsh-commands invocation object). */
function executeCommand(input: unknown, deps: StatusCommandDeps): CommandResult {
  const args = extractArgs(input).trim()
  const subcommand = args === '' ? 'status' : (args.split(/\s+/u)[0] ?? '').toLowerCase()
  const lang = resolveLang(deps)
  try {
    switch (subcommand) {
      case 'status':
        return { kind: 'success', text: deps.statusText() }
      case 'next':
        deps.next()
        return { kind: 'success', text: t(lang, 'cmd.next') }
      case 'on':
        deps.setEnabled(true)
        return { kind: 'success', text: t(lang, 'cmd.on') }
      case 'off':
        deps.setEnabled(false)
        return { kind: 'success', text: t(lang, 'cmd.off') }
      default:
        return {
          kind: 'error',
          text: t(lang, 'cmd.unknown') + ' (' + sanitizeArg(subcommand) + ')',
        }
    }
  } catch (error) {
    // The command surface must never receive a rejected promise: a controller
    // failure becomes an error result with the reason.
    return { kind: 'error', text: 'status-rotator: ' + describe(error) }
  }
}

/** Read the raw command tail from either supported handler input shape. */
function extractArgs(input: unknown): string {
  if (typeof input === 'string') return input
  if (input !== null && typeof input === 'object') {
    try {
      const rawInput = (input as HostCommandInvocationLike).rawInput
      if (typeof rawInput === 'string') return rawInput
    } catch {
      return ''
    }
  }
  return ''
}

/** Render one invalid subcommand token without control characters. */
function sanitizeArg(value: string): string {
  return value.replace(/[^\w:-]/gu, '').slice(0, 32)
}

/** Resolve the message language: injected getter first, then the TUI language. */
function resolveLang(deps: StatusCommandDeps): Lang {
  if (typeof deps.lang === 'function') {
    try {
      const value = deps.lang()
      if (value === 'zh' || value === 'en') return value
    } catch {
      // Fall through to auto-detection.
    }
  }
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale
    return detectLanguage(process.env, readTuiLanguageFile, locale)
  } catch {
    return 'zh'
  }
}

/** Best-effort read of ~/.dsh-tui/lang.json (missing/corrupt falls through). */
function readTuiLanguageFile(): unknown {
  try {
    const raw = JSON.parse(readFileSync(join(homedir(), '.dsh-tui', 'lang.json'), 'utf8')) as unknown
    if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
      const lang = (raw as Record<string, unknown>).lang
      return typeof lang === 'string' ? lang : undefined
    }
  } catch {
    // No language file: fall through to the OS locale.
  }
  return undefined
}

/** Wrap a host disposer so a failing cleanup is reported, never thrown. */
function safeDisposer(dispose: () => void, diagnostics: DiagnosticsSink, code: string): () => void {
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    try {
      dispose()
    } catch (error) {
      diagnostics.warn(code, 'command unregister failed: ' + describe(error))
    }
  }
}

/** Diagnostics fallback used when the caller supplies no sink (logs to ctx). */
function createLoggerSink(ctx: StructuralContext): DiagnosticsSink {
  return {
    warn(code: string, message: string): void {
      try {
        ctx.logger?.warn('[dsh-tui-status-rotator] ' + message + ' (' + code + ')')
      } catch {
        // Logging must never break command registration.
      }
    },
    list(): readonly Diagnostic[] {
      return []
    },
  }
}

/** Short single-line error text (never throws). */
function describe(error: unknown): string {
  try {
    if (error instanceof Error) return error.message.replace(/\s+/gu, ' ').slice(0, 200)
    return String(error).replace(/\s+/gu, ' ').slice(0, 200)
  } catch {
    return 'unknown error'
  }
}
