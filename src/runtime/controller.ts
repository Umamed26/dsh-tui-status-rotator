/**
 * Rotation controller: the single writer of view frames.
 *
 * It owns the cadence (rotation interval + phase transitions), draws from the
 * selection engine, resolves placeholders, merges third-party phrase
 * providers, resolves the active preset/schedule and publishes immutable
 * frames to the store. The rich status view only animates what it reads.
 *
 * All side effects are clock-injected; every error path degrades to "line
 * hidden + diagnostic", never to a thrown exception inside a cordis event
 * handler.
 *
 * @module dsh-tui-status-rotator/runtime/controller
 */
import type {
  BankDoc,
  BankWarning,
  DiagnosticsSink,
  GradientSpec,
  Lang,
  LiveContext,
  MergedBank,
  PackDoc,
  PhraseEntry,
  PhraseGroupsInput,
  PhraseInput,
  PhraseProviderSite,
  Phase,
  ResolvedConfig,
  SessionState,
} from '../types.js'
import type { SelectionEngine, SelectionSnapshot } from '../types.js'
import { createSelectionEngine } from '../engine/selection.js'
import { createPlaceholderResolver } from '../engine/placeholders.js'
import { resolveGradientSpec } from '../engine/render.js'
import { resolveActivePreset } from '../engine/schedule.js'
import { mergeBank, mergePhaseEntries } from '../bank/normalize.js'
import { phaseOf } from './phase.js'
import type { ViewFrameStore } from './store.js'

/** The phrase sources the controller builds banks from (assembled by index). */
export interface BankSources {
  readonly core?: BankDoc['phrases']
  readonly packs: readonly PackDoc[]
  readonly enabledPacks?: readonly string[] | null
}

/** One provider registered through the public extension service. */
export type PhraseProvider = (site: PhraseProviderSite) => readonly PhraseInput[] | PhraseGroupsInput

/** Options for the controller. Every external read is injected. */
export interface RotationControllerOptions {
  config: ResolvedConfig
  sources: BankSources
  lang: Lang
  store: ViewFrameStore
  diagnostics: DiagnosticsSink
  /** Latest live session facts; undefined = no active session. */
  state?: () => SessionState | undefined
  /** Third-party phrase providers (extension service). */
  providers?: () => readonly PhraseProvider[]
  /** Third-party placeholder values (extension service), read per frame. */
  placeholders?: (live: LiveContext) => Readonly<Record<string, string>>
  clock?: () => number
  rng?: () => number
  /** Controller tick in ms; 500 keeps phase transitions snappy without churn. */
  tickMs?: number
}

/** The currently displayed phrase. */
interface CurrentPhrase {
  readonly phase: Phase
  readonly startedAt: number
  /** Raw template (placeholders unresolved). */
  readonly rawText: string
  /** Last resolved text, for status output + plain fallback. */
  resolvedText: string
}

/** Snapshot exposed to the /status-rotator command. */
export interface ControllerStatus {
  readonly enabled: boolean
  readonly configuredEnabled: boolean
  readonly labelSource: 'phrases' | 'host'
  readonly lang: Lang
  readonly phase: Phase | undefined
  readonly line: string | undefined
  readonly visible: boolean
  readonly presetId: string | null
  readonly packs: readonly string[]
  readonly bankWarnings: readonly BankWarning[]
  readonly ticking: boolean
}

/**
 * Drives the rotating status line.
 */
export class RotationController {
  private config: ResolvedConfig
  private sources: BankSources
  private lang: Lang
  private readonly store: ViewFrameStore
  private readonly diagnostics: DiagnosticsSink
  private readonly stateProvider: () => SessionState | undefined
  private readonly providerSource: () => readonly PhraseProvider[]
  private readonly placeholderSource: (live: LiveContext) => Readonly<Record<string, string>>
  private readonly clock: () => number
  private readonly engine: SelectionEngine
  private readonly resolver = createPlaceholderResolver()
  private readonly tickMs: number
  private timer: ReturnType<typeof setInterval> | undefined
  private baseBank: MergedBank
  private presetBank: MergedBank | undefined
  private presetCacheKey: string | undefined
  private current: CurrentPhrase | undefined
  private presetId: string | null = null
  private enabledOverride: boolean | undefined
  private readonly bankWarnings: BankWarning[]

  constructor(options: RotationControllerOptions) {
    this.config = options.config
    this.sources = options.sources
    this.lang = options.lang
    this.store = options.store
    this.diagnostics = options.diagnostics
    this.stateProvider = options.state ?? (() => undefined)
    this.providerSource = options.providers ?? (() => [])
    this.placeholderSource = options.placeholders ?? (() => ({}))
    this.clock = options.clock ?? Date.now
    this.engine = createSelectionEngine(options.rng === undefined ? {} : { rng: options.rng })
    this.tickMs = options.tickMs ?? 500
    const merged = mergeBank({ core: this.sources.core, packs: this.sources.packs, enabledPacks: this.sources.enabledPacks })
    this.baseBank = merged
    this.bankWarnings = merged.warnings.slice()
    this.reportBankWarnings()
  }

  /** Start the rotation timer (idempotent) and render the first frame. */
  start(): void {
    if (this.timer !== undefined) return
    this.timer = setInterval(() => this.tick(), this.tickMs)
    // The interval object must not keep a headless process alive on its own.
    const maybeUnref = this.timer as unknown as { unref?: () => void }
    maybeUnref.unref?.()
    this.tick()
  }

  /** Stop the rotation timer and hide the line. */
  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer)
      this.timer = undefined
    }
    this.hide()
  }

  /** Update config (settings reload / row config change). */
  setConfig(config: ResolvedConfig): void {
    const previous = this.config
    this.config = config
    if (previous.intervalMs !== config.intervalMs
      || previous.labelSource !== config.labelSource
      || previous.enabled !== config.enabled
      || previous.typeSpeedMs !== config.typeSpeedMs
      || previous.gradientEnabled !== config.gradientEnabled
      || previous.gradientMode !== config.gradientMode
      || previous.gradientDirection !== config.gradientDirection
      || previous.gradientSpeedSec !== config.gradientSpeedSec) {
      this.current = undefined
    }
    if (config.presets.length === 0 && config.schedule.length === 0 && config.activePreset == null) {
      this.presetId = null
      this.presetBank = undefined
      this.presetCacheKey = undefined
    }
    this.tick()
  }

  /** Update bank sources (external bank reload / config pack selection). */
  setSources(sources: BankSources): void {
    this.sources = sources
    this.rebuildBaseBank()
    this.presetBank = undefined
    this.presetCacheKey = undefined
    this.engine.reset()
    this.current = undefined
    this.tick()
  }

  /** Switch the phrase language. */
  setLanguage(lang: Lang): void {
    if (this.lang === lang) return
    this.lang = lang
    this.current = undefined
    this.tick()
  }

  /** Runtime on/off override from the /status-rotator command. */
  setEnabled(enabled: boolean): void {
    this.enabledOverride = enabled
    if (!enabled) this.hide()
    this.tick()
  }

  /** Whether the line is currently enabled (override wins over config). */
  enabled(): boolean {
    return this.enabledOverride ?? this.config.enabled
  }

  /** Force the next phrase (command: next). */
  next(): void {
    this.current = undefined
    this.tick()
  }

  /** One controller step; exposed for tests and forced refreshes. */
  tick(): void {
    try {
      this.step(this.clock())
    } catch (error) {
      this.diagnostics.warn('runtime.tick', 'rotation tick failed: ' + describe(error))
      this.hide()
    }
  }

  /** Diagnostics/status snapshot for the command output. */
  status(): ControllerStatus {
    return {
      enabled: this.enabled(),
      configuredEnabled: this.config.enabled,
      labelSource: this.config.labelSource,
      lang: this.lang,
      phase: this.current?.phase,
      line: this.current?.resolvedText,
      visible: this.store.snapshot.visible,
      presetId: this.presetId,
      packs: this.baseBank.includedPacks,
      bankWarnings: this.bankWarnings.slice(),
      ticking: this.timer !== undefined,
    }
  }

  /** Bank warnings introduced after construction (external reload). */
  bankWarningsList(): readonly BankWarning[] {
    return this.bankWarnings.slice()
  }

  /** Selection-engine memory for the extension API status output. */
  engineSnapshot(): SelectionSnapshot {
    return this.engine.snapshot()
  }

  /** One internal step. */
  private step(now: number): void {
    if (!this.enabled() || this.config.labelSource === 'host') {
      this.hide()
      return
    }
    const state = this.stateProvider()
    if (state === undefined || !state.running) {
      this.hide()
      return
    }
    const phase = phaseOf(state.turnStartedAt, now, {
      thinkingMs: this.config.thinkingMs,
      longAfterMs: this.config.longAfterMs,
    })
    this.resolvePreset(now)
    const bank = this.effectiveBank()
    const current = this.current
    const dueForRotation = current === undefined
      || current.phase !== phase
      || now - current.startedAt >= this.config.intervalMs
    if (dueForRotation) {
      this.draw(now, phase, state, bank)
      return
    }
    // Same phrase: refresh only the live placeholders (elapsed, pending, tps).
    this.publish(current.rawText, now, phase, state, current.startedAt)
  }

  /** Resolve the active preset for the schedule and swap the bank if needed. */
  private resolvePreset(now: number): void {
    if (this.config.presets.length === 0 && this.config.schedule.length === 0 && this.config.activePreset == null) {
      if (this.presetId !== null) {
        this.presetId = null
        this.presetBank = undefined
        this.current = undefined
      }
      return
    }
    const resolved = resolveActivePreset(
      this.config.presets,
      this.config.schedule,
      this.config.activePreset,
      new Date(now),
    )
    for (const warning of resolved.warnings) this.diagnostics.warn(warning.code, warning.message)
    if (resolved.presetId === this.presetId) return
    this.presetId = resolved.presetId
    this.presetBank = undefined
    this.presetCacheKey = undefined
    this.current = undefined
  }

  /** The bank in effect: base bank or the scheduled/pinned preset snapshot. */
  private effectiveBank(): MergedBank {
    if (this.presetId === null) return this.baseBank
    if (this.presetBank !== undefined) return this.presetBank
    const preset = this.config.presets.find(candidate => candidate.id === this.presetId)
    if (preset === undefined) {
      this.presetId = null
      return this.baseBank
    }
    const core = {
      ...(preset.phrases?.zh === undefined ? { zh: this.sources.core?.zh } : { zh: preset.phrases.zh }),
      ...(preset.phrases?.en === undefined ? { en: this.sources.core?.en } : { en: preset.phrases.en }),
    }
    const packs = preset.packs === undefined ? this.sources.packs : preset.packs
    const enabledPacks = preset.enabledPacks === undefined ? this.sources.enabledPacks : preset.enabledPacks
    const merged = mergeBank({ core, packs, enabledPacks })
    for (const warning of merged.warnings) this.diagnostics.warn(warning.code, warning.message)
    this.presetBank = merged
    this.presetCacheKey = preset.id
    return merged
  }

  /** Draw one phrase and publish it. */
  private draw(now: number, phase: Phase, state: SessionState, bank: MergedBank): void {
    const live = this.buildLive(state, phase, now)
    const entries = this.phaseEntries(bank, phase, live)
    const bankForPick: MergedBank = entries === bank[this.lang][phase]
      ? bank
      : {
          ...bank,
          [this.lang]: { ...bank[this.lang], [phase]: entries },
        }
    const pick = this.engine.pick({
      bank: bankForPick,
      live,
      weighted: this.config.weightedRandom,
      antiRepeatRecentLimit: this.config.antiRepeatRecentLimit,
    })
    if (pick === undefined) {
      this.diagnostics.warn('bank.empty', 'no phrase available for phase "' + phase + '" in "' + this.lang + '"; the host line stays untouched')
      this.hide()
      return
    }
    this.current = { phase, startedAt: now, rawText: pick.text, resolvedText: '' }
    this.publish(pick.text, now, phase, state, now)
  }

  /** Resolve placeholders and publish a frame. */
  private publish(rawText: string, now: number, phase: Phase, state: SessionState, startedAt: number): void {
    const live = this.buildLive(state, phase, now)
    const resolved = this.resolver.resolve(rawText, live)
    for (const name of resolved.unknown.slice(0, 4)) {
      this.diagnostics.warn('placeholder.unknown', 'unknown placeholder {' + name + '} in phrase "' + rawText.slice(0, 40) + '"')
    }
    const text = resolved.text
    if (text.trim() === '') {
      this.hide()
      return
    }
    if (this.current !== undefined && this.current.startedAt === startedAt) {
      this.current = { ...this.current, resolvedText: text }
    }
    const gradient: GradientSpec | undefined = resolveGradientSpec(this.config)
    this.store.publish({
      visible: true,
      phase,
      lang: this.lang,
      text,
      startedAt,
      typeSpeedMs: this.config.typeSpeedMs,
      ...(gradient === undefined ? {} : { gradient }),
    })
  }

  /** Merge third-party provider phrases into the current phase group. */
  private phaseEntries(bank: MergedBank, phase: Phase, live: LiveContext): readonly PhraseEntry[] {
    const base = bank[this.lang][phase]
    const providers = this.providerSource()
    if (providers.length === 0) return base
    const site: PhraseProviderSite = { lang: this.lang, phase, live }
    const extras: PhraseInput[] = []
    for (const provider of providers) {
      try {
        const result = provider(site)
        if (Array.isArray(result)) {
          extras.push(...result)
          continue
        }
        if (result !== null && typeof result === 'object') {
          const groups = result as PhraseGroupsInput
          const phaseInputs = groups[phase]
          if (Array.isArray(phaseInputs)) extras.push(...phaseInputs)
        }
      } catch (error) {
        this.diagnostics.warn('provider.failed', 'phrase provider failed: ' + describe(error))
      }
    }
    if (extras.length === 0) return base
    return mergePhaseEntries(base, extras, 'provider')
  }

  /** Build the live facts for placeholder resolution and conditions. */
  private buildLive(state: SessionState, phase: Phase, now: number): LiveContext {
    const date = new Date(now)
    const base: LiveContext = {
      lang: this.lang,
      phase,
      now,
      hour: date.getHours(),
      elapsedMs: state.running ? Math.max(0, now - state.turnStartedAt) : 0,
      running: state.running,
      tool: state.tools,
      retry: state.retry,
      ...(state.retryMax === undefined ? {} : { retryMax: state.retryMax }),
      pending: state.pending,
      firstTurn: state.firstTurn,
      ...(state.model === undefined ? {} : { model: state.model }),
      ...(state.provider === undefined ? {} : { provider: state.provider }),
      ...(state.tps === undefined ? {} : { tps: state.tps }),
    }
    const vars = this.placeholderSource(base)
    return Object.keys(vars).length === 0 ? base : { ...base, vars }
  }

  /** Rebuild the base bank and remember normalization warnings. */
  private rebuildBaseBank(): void {
    const merged = mergeBank({ core: this.sources.core, packs: this.sources.packs, enabledPacks: this.sources.enabledPacks })
    this.baseBank = merged
    this.bankWarnings.length = 0
    this.bankWarnings.push(...merged.warnings)
    this.reportBankWarnings()
  }

  /** Surface each bank normalization warning exactly once. */
  private reportBankWarnings(): void {
    for (const warning of this.bankWarnings) this.diagnostics.warn(warning.code, warning.message)
  }

  /** Hide the line and forget the current phrase. */
  private hide(): void {
    this.current = undefined
    this.store.hide()
  }
}

/** Error to a short single-line string (status output must stay one line). */
function describe(error: unknown): string {
  if (error instanceof Error) return error.message.replace(/\s+/g, ' ').slice(0, 200)
  return String(error).replace(/\s+/g, ' ').slice(0, 200)
}
