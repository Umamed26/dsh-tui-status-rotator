/**
 * External, hand-editable phrase-bank file with hot reload.
 *
 * Port of the web plugin's external bank layer (\`$DSH_HOME/status-rotator/
 * phrases.json\`, env \`DSH_STATUS_ROTATOR_BANK\`), relocated to the dsh-TUI data
 * directory convention: \`~/.dsh-tui/status-rotator/bank.json\`, overridable via
 * the \`bankPath\` config key or the \`DSH_TUI_STATUS_ROTATOR_BANK\` env var.
 *
 * Contract (matches the web original):
 *   - the file is optional; missing = the external layer is simply off, not an
 *     error (\`status.loaded === false\`, \`status.error === null\`);
 *   - the file is a regular JSON bank document containing only the keys it
 *     wants to override (\`packs\` / \`phrases\` / \`enabledPacks\`); other keys
 *     (notably \`config\`) are ignored;
 *   - a corrupt or invalid document never replaces the last good one: the
 *     previous document keeps serving and the error is exposed through
 *     \`status()\` and the \`log\` callback;
 *   - changes are picked up by a 2 s mtime+size poll; unchanged files are not
 *     re-read (mtime in nanoseconds, canonicalized text is compared as well, so
 *     a same-tick rewrite is not missed);
 *   - \`stop()\` removes the watcher; \`start()\` is idempotent and loads once.
 *
 * Unlike the web original, a loaded file that later disappears is reported
 * through \`onReload({})\` once: that is the only way to tell the runtime that
 * the external layer must fall back to the built-in bank (the runtime keeps
 * the last document otherwise).
 *
 * @module dsh-tui-status-rotator/bank/external
 */
import { readFileSync, statSync, unwatchFile, watchFile } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import type { BankDoc, BankWarning } from '../types.js'
import { normalizeBankDoc } from './normalize.js'

/** Environment variable overriding the bank file path. */
export const EXTERNAL_BANK_ENV = 'DSH_TUI_STATUS_ROTATOR_BANK'

/** File name inside the plugin data directory. */
export const EXTERNAL_BANK_FILE = 'bank.json'

/** Poll interval for the file watcher, in milliseconds. */
export const EXTERNAL_BANK_POLL_MS = 2000

/** Loader state exposed for the \`/status-rotator status\` command and tests. */
export interface ExternalBankStatus {
  /** Whether the last load attempt ended without an error. */
  readonly ok: boolean
  /** Absolute path of the watched file. */
  readonly path: string
  /** Whether a document from this file is currently in effect. */
  readonly loaded: boolean
  /** Last load error (parse/validation/read); null after a success or when missing. */
  readonly error: string | null
  /** Number of successful document changes since \`start()\`. */
  readonly reloads: number
  /** Epoch ms of the last successful load, null before the first one. */
  readonly lastLoadedAt: number | null
}

/** Handle returned by {@link createExternalBank}. */
export interface ExternalBankHandle {
  /** Load once and start watching the file (idempotent). */
  start(): void
  /** Stop watching (idempotent); status keeps its last value. */
  stop(): void
  /** Current status snapshot. */
  status(): ExternalBankStatus
  /** Last good normalized document, or null when the external layer is off. */
  current(): BankDoc | null
  /** Force one immediate load/validation pass (used by tests). */
  reloadNow(): void
}

/** Options accepted by {@link createExternalBank}. */
export interface ExternalBankOptions {
  /** Plugin data directory; default \`~/.dsh-tui/status-rotator\`. */
  readonly dir?: string
  /** Explicit file path (config \`bankPath\`); wins over the env var and dir. */
  readonly file?: string | null
  /** Environment used for \`DSH_TUI_STATUS_ROTATOR_BANK\` (default \`process.env\`). */
  readonly env?: NodeJS.ProcessEnv
  /** Called with every accepted document (including the initial load). */
  readonly onReload: (doc: BankDoc) => void
  /** Clock injection for \`lastLoadedAt\` (default \`Date.now\`). */
  readonly now?: () => number
  /** Diagnostic sink for load errors and normalization warnings. */
  readonly log?: (code: string, message: string) => void
}

/** The host's home directory (mirrors dsh-TUI's utils/paths convention). */
function homeDirectory(env: NodeJS.ProcessEnv): string {
  return homedir() || env.USERPROFILE || env.HOME || ''
}

/** Default external-bank directory: \`<home>/.dsh-tui/status-rotator\`. */
export function defaultExternalBankDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(homeDirectory(env), '.dsh-tui', 'status-rotator')
}

/** Expand a leading \`~\` and resolve relative paths against the process cwd. */
export function expandBankPath(path: string, env: NodeJS.ProcessEnv = process.env): string {
  let expanded = path
  if (expanded === '~') expanded = homeDirectory(env)
  else if (expanded.startsWith('~/') || expanded.startsWith('~\\')) expanded = join(homeDirectory(env), expanded.slice(2))
  return isAbsolute(expanded) ? expanded : resolve(process.cwd(), expanded)
}

/**
 * Resolve the bank file path from options, then the environment, then the
 * default directory. Kept pure so the path precedence is testable.
 */
export function resolveExternalBankPath(options: Pick<ExternalBankOptions, 'dir' | 'file' | 'env'> = {}): string {
  const env = options.env ?? process.env
  const explicit = typeof options.file === 'string' && options.file.trim().length > 0 ? options.file.trim() : undefined
  if (explicit !== undefined) return expandBankPath(explicit, env)
  const fromEnv = env[EXTERNAL_BANK_ENV]
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) return expandBankPath(fromEnv.trim(), env)
  const dir = typeof options.dir === 'string' && options.dir.trim().length > 0 ? options.dir.trim() : defaultExternalBankDir(env)
  return join(dir, EXTERNAL_BANK_FILE)
}

/** Short single-line error text for status output. */
function describe(error: unknown): string {
  if (error instanceof Error) return error.message.replace(/\s+/g, ' ').slice(0, 300)
  return String(error).replace(/\s+/g, ' ').slice(0, 300)
}

/** Node fs error code, when present. */
function errorCode(error: unknown): string | undefined {
  if (error !== null && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code
    return typeof code === 'string' ? code : undefined
  }
  return undefined
}

/**
 * Create the external-bank loader (no side effects until \`start()\`).
 *
 * Loading never throws: every failure path keeps the last good document and
 * reports through \`log\` / \`status()\`.
 */
export function createExternalBank(options: ExternalBankOptions): ExternalBankHandle {
  const now = options.now ?? Date.now
  const env = options.env ?? process.env
  const log = options.log ?? (() => undefined)
  const path = resolveExternalBankPath({ ...(options.dir === undefined ? {} : { dir: options.dir }), ...(options.file === undefined ? {} : { file: options.file }), env })

  let started = false
  let document: BankDoc | null = null
  let error: string | null = null
  let loaded = false
  let reloads = 0
  let lastLoadedAt: number | null = null
  /** Last stat signature (\`mtimeNs:size\`); null until a file was seen. */
  let lastSignature: string | null = null
  /** Last text read from the file, to catch same-tick rewrites. */
  let lastText: string | null = null
  /** Whether the previous successful load came from an existing file. */
  let hadFile = false

  /** Report every normalization warning through the diagnostic sink. */
  const reportWarnings = (warnings: readonly BankWarning[]): void => {
    for (const warning of warnings) log(warning.code, warning.message)
  }

  /** Apply a successful document load. */
  const emit = (doc: BankDoc): void => {
    document = doc
    loaded = true
    hadFile = true
    error = null
    reloads += 1
    lastLoadedAt = now()
    try {
      options.onReload(doc)
    } catch (callbackError) {
      log('bank.external-callback', 'external bank onReload callback failed: ' + describe(callbackError))
    }
  }

  /** Forget the external layer (the file disappeared after a successful load). */
  const clear = (): void => {
    if (!hadFile && document === null) return
    document = null
    loaded = false
    hadFile = false
    error = null
    try {
      options.onReload({})
    } catch (callbackError) {
      log('bank.external-callback', 'external bank onReload callback failed: ' + describe(callbackError))
    }
  }

  /**
   * One load pass. Reads only when the file metadata changed, and only
   * counts a reload when the normalized content actually changed.
   */
  const load = (): void => {
    let info
    try {
      info = statSync(path, { bigint: true })
    } catch (statError) {
      const code = errorCode(statError)
      if (code === 'ENOENT') {
        // Missing file = external layer disabled; not an error.
        lastSignature = null
        lastText = null
        if (hadFile || document !== null) clear()
        else {
          error = null
          loaded = false
        }
        return
      }
      const message = 'cannot stat external bank ' + path + ': ' + describe(statError)
      error = message
      log('bank.external-stat', message)
      return
    }

    const signature = String(info.mtimeNs) + ':' + String(info.size)
    if (lastSignature === signature) return
    lastSignature = signature

    let text: string
    try {
      text = readFileSync(path, 'utf8')
    } catch (readError) {
      // Race: the file was removed/replaced between stat and read. Keep the
      // last good document; a later poll will pick up the new state.
      const message = 'cannot read external bank ' + path + ': ' + describe(readError)
      error = message
      log('bank.external-read', message)
      return
    }

    if (lastText === text && loaded) return
    lastText = text

    let parsed: unknown
    try {
      parsed = JSON.parse(text) as unknown
    } catch (parseError) {
      const message = 'external bank ' + path + ' is not valid JSON: ' + describe(parseError)
      error = message
      log('bank.external-parse', message)
      return
    }

    const normalized = normalizeBankDoc(parsed, path)
    reportWarnings(normalized.warnings)
    if (!normalized.valid) {
      error = 'external bank ' + path + ' is not a usable bank document'
      log('bank.external-invalid', error)
      return
    }
    emit(normalized.doc)
  }

  /** Watcher listener shared by \`stop()\` so only our own watch is removed. */
  const onWatch = (): void => {
    try {
      load()
    } catch (watchError) {
      log('bank.external-watch', 'external bank reload failed: ' + describe(watchError))
    }
  }

  return {
    start(): void {
      if (started) return
      started = true
      try {
        load()
      } catch (loadError) {
        log('bank.external-watch', 'external bank initial load failed: ' + describe(loadError))
      }
      try {
        watchFile(path, { interval: EXTERNAL_BANK_POLL_MS, persistent: false }, onWatch)
      } catch (watchError) {
        log('bank.external-watch', 'cannot watch external bank ' + path + ': ' + describe(watchError))
      }
    },
    stop(): void {
      if (!started) return
      started = false
      try {
        unwatchFile(path, onWatch)
      } catch {
        // fs.unwatchFile never throws on an unknown listener; keep the contract.
      }
    },
    status(): ExternalBankStatus {
      return {
        ok: error === null,
        path,
        loaded,
        error,
        reloads,
        lastLoadedAt,
      }
    },
    current(): BankDoc | null {
      return document
    },
    reloadNow(): void {
      try {
        load()
      } catch (loadError) {
        log('bank.external-watch', 'external bank manual reload failed: ' + describe(loadError))
      }
    },
  }
}