/**
 * The cordis service this plugin provides for other plugins (the TUI port of
 * the web plugin's ctx.statusRotator): register extra packs, placeholders and
 * dynamic phrase providers without editing this package.
 *
 * Registration is explicit-failure: duplicate ids, collisions with built-in
 * placeholders and non-function providers throw at registration time instead
 * of producing a silent no-op. Content registered here is never persisted into
 * config files, matching the original contract.
 *
 * @module dsh-tui-status-rotator/runtime/service
 */
import type {
  Diagnostic,
  DiagnosticsSink,
  Lang,
  LiveContext,
  PackDoc,
  Phase,
  PhraseGroupsInput,
  PhraseInput,
  PhraseProviderSite,
  SelectionSnapshot,
  StatusRotatorApi,
} from '../types.js'
import { BUILTIN_PLACEHOLDER_NAMES } from '../engine/placeholders.js'

/**
 * Placeholder names owned by the built-in resolver; third parties cannot
 * override them. The engine's built-in list is the single source of truth so
 * the registration guard cannot drift from what the resolver actually knows.
 */
export const RESERVED_PLACEHOLDERS: ReadonlySet<string> = BUILTIN_PLACEHOLDER_NAMES

/** One dynamic phrase provider registered by another plugin. */
export type RegisteredProvider = (site: PhraseProviderSite) => readonly PhraseInput[] | PhraseGroupsInput

/** Mutable registry behind the public service (owned by index, read by controller). */
export interface ExtensionState {
  readonly packs: PackDoc[]
  readonly providers: RegisteredProvider[]
  readonly placeholders: Map<string, (live: LiveContext) => string>
}

/** Create an empty extension registry. */
export function createExtensionState(): ExtensionState {
  return { packs: [], providers: [], placeholders: new Map() }
}

/**
 * Provider view over registered packs, so packs registered at runtime join the
 * same selection pipeline (dedupe/conditions/weights) as the built-in bank.
 */
export function packPhraseProvider(state: ExtensionState): RegisteredProvider {
  return (site: PhraseProviderSite): readonly PhraseInput[] => {
    const inputs: PhraseInput[] = []
    for (const pack of state.packs) {
      const groups = pack.phrases[site.lang]
      const phaseInputs = groups === undefined ? undefined : groups[site.phase]
      if (Array.isArray(phaseInputs)) inputs.push(...phaseInputs)
    }
    return inputs
  }
}

/** Resolve all third-party placeholder values for one frame. */
export function resolveExtensionPlaceholders(
  state: ExtensionState,
  diagnostics: DiagnosticsSink,
  live: LiveContext,
): Readonly<Record<string, string>> {
  if (state.placeholders.size === 0) return {}
  const values: Record<string, string> = {}
  for (const [name, resolve] of state.placeholders) {
    try {
      const value = resolve(live)
      if (typeof value === 'string') values[name] = value
    } catch (error) {
      diagnostics.warn('placeholder.failed', 'placeholder "' + name + '" failed: ' + (error instanceof Error ? error.message : String(error)).slice(0, 160))
    }
  }
  return values
}

/** Host seam availability reported by the extension API status(). */
export interface HostFlags {
  readonly richStatusView: boolean
  readonly plainStatus: boolean
  readonly settingsSection: boolean
  readonly commands: boolean
}

/** Dependencies for the public service. */
export interface StatusRotatorServiceOptions {
  readonly state: ExtensionState
  readonly diagnostics: DiagnosticsSink
  readonly hostFlags: () => HostFlags
  readonly engineSnapshot: () => SelectionSnapshot
  readonly includedPacks: () => readonly string[]
}

/** Validate a pack shape from another plugin (untrusted in-process input). */
function assertPack(pack: PackDoc): void {
  if (pack === null || typeof pack !== 'object') throw new Error('statusRotator.registerPack: pack must be an object')
  if (typeof pack.id !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(pack.id)) {
    throw new Error('statusRotator.registerPack: pack.id must match /^[a-z0-9][a-z0-9_-]*$/')
  }
  if (pack.phrases === null || typeof pack.phrases !== 'object') {
    throw new Error('statusRotator.registerPack: pack.phrases must be an object')
  }
}

/** Build the public extension API. */
export function createStatusRotatorService(options: StatusRotatorServiceOptions): StatusRotatorApi {
  const { state, diagnostics } = options
  return {
    version: 1,
    registerPack(pack: PackDoc): () => void {
      assertPack(pack)
      if (state.packs.some(existing => existing.id === pack.id)) {
        throw new Error('statusRotator.registerPack: pack id "' + pack.id + '" is already registered')
      }
      state.packs.push(pack)
      return () => {
        const index = state.packs.findIndex(existing => existing === pack)
        if (index >= 0) state.packs.splice(index, 1)
      }
    },
    registerPlaceholder(name: string, resolve: (live: LiveContext) => string): () => void {
      if (typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
        throw new Error('statusRotator.registerPlaceholder: name must be an alphanumeric identifier')
      }
      if (RESERVED_PLACEHOLDERS.has(name)) {
        throw new Error('statusRotator.registerPlaceholder: "' + name + '" is a built-in placeholder')
      }
      if (state.placeholders.has(name)) {
        throw new Error('statusRotator.registerPlaceholder: "' + name + '" is already registered')
      }
      if (typeof resolve !== 'function') {
        throw new Error('statusRotator.registerPlaceholder: resolver must be a function')
      }
      state.placeholders.set(name, resolve)
      return () => {
        state.placeholders.delete(name)
      }
    },
    registerPhraseProvider(provider: RegisteredProvider): () => void {
      if (typeof provider !== 'function') {
        throw new Error('statusRotator.registerPhraseProvider: provider must be a function')
      }
      state.providers.push(provider)
      return () => {
        const index = state.providers.indexOf(provider)
        if (index >= 0) state.providers.splice(index, 1)
      }
    },
    status() {
      const diagnosticsList: readonly Diagnostic[] = diagnostics.list()
      return {
        version: 1,
        host: options.hostFlags(),
        engine: options.engineSnapshot(),
        packs: options.includedPacks(),
        diagnostics: diagnosticsList,
      }
    },
  }
}

/** Empty selection snapshot used before the controller exists (defensive). */
export const EMPTY_SELECTION_SNAPSHOT: SelectionSnapshot = { bags: {}, recent: {} }

/** Phase helper retained for the service status output. */
export function describePhase(phase: Phase | undefined, lang: Lang): string {
  if (phase === undefined) return lang === 'en' ? 'idle' : '空闲'
  return lang === 'en' ? phase : phase === 'thinking' ? '思考中' : phase === 'running' ? '运行中' : '长任务中'
}
