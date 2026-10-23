/**
 * Phrase selection engine: the TUI port of the web plugin's draw pipeline.
 *
 * One draw is: rarity gate -> conditional/plain partition (conditional
 * priority) -> shuffle-bag draw inside the active language+phase bag, with
 * cross-bag anti-repeat memory. All randomness is injected, there is no clock
 * and no I/O, so every draw is reproducible in tests.
 *
 * Semantics are pinned to the original plugin (README_ZH sections
 * "加权随机 / 反重复(洗牌袋) / 条件句(when)与稀有句" and
 * scripts/verify-phrase-selection.cjs):
 *
 * - weights are clamped to 1..1000; anything invalid counts as 1, and
 *   `weighted: false` turns the draw fully uniform;
 * - a shuffle bag per `lang|phase` never repeats a phrase inside one round;
 *   when a bag is refilled at a seam the last `antiRepeatRecentLimit` (0..50)
 *   texts are trimmed so the seam does not repeat either. A changed candidate
 *   pool (phase/language/condition change) restarts the bag, so stale phrases
 *   never leak through;
 * - rarity is rolled first, with exactly one `rng()` call per entry that
 *   declares a rarity in (0, 1). If the rolls empty the pool the full pool is
 *   used again, so an unlucky roll can never blank the status line;
 * - `when` conditions are AND-ed. If any conditional entry matches, the draw
 *   pool is exactly the matching conditionals (a single `tool: "bash"` phrase
 *   must not be drowned by a thousand unconditional ones); otherwise the plain
 *   entries are used; if every entry is conditional and none matches, the full
 *   eligible pool is used so the line still rotates;
 * - conditions fail closed: no running tool means every `tool` rule is false,
 *   and `hour` is evaluated against `LiveContext.hour` (the engine never reads
 *   the clock on its own).
 *
 * @module dsh-tui-status-rotator/engine/selection
 */
import type {
  LiveContext,
  MergedBank,
  PhraseEntry,
  PhrasePick,
  PickRequest,
  SelectionEngine,
  SelectionSnapshot,
  WhenCondition,
} from '../types.js'

/** Weight cap from the original plugin (invalid or below 1 counts as 1). */
export const MAX_PHRASE_WEIGHT = 1000

/** Anti-repeat memory cap from the original plugin (0..50). */
export const MAX_RECENT_LIMIT = 50

/** Memory length used when the caller does not supply a usable value. */
export const DEFAULT_RECENT_LIMIT = 3

/** Rotation phases a `when.phase` rule may name (the TUI port has no idle phase). */
const PHASE_VALUES: readonly string[] = ['thinking', 'running', 'long']

/** Clamp one phrase weight into the original 1..1000 range. */
export function normalizePhraseWeight(weight: unknown): number {
  if (typeof weight !== 'number' || !Number.isFinite(weight)) return 1
  if (weight < 1) return 1
  return Math.min(weight, MAX_PHRASE_WEIGHT)
}

/** Normalize rarity: only a finite number in (0, 1] is valid; anything else is "no gate". */
export function normalizeRarity(rarity: unknown): number | undefined {
  if (typeof rarity !== 'number' || !Number.isFinite(rarity)) return undefined
  if (rarity <= 0 || rarity > 1) return undefined
  return rarity
}

/** Whether `hour` is inside a [from, to) local-hour window; from === to means all day. */
export function hourInWindow(window: readonly [number, number], hour: number): boolean {
  const from = window[0]
  const to = window[1]
  if (!Number.isFinite(hour)) return false
  const normalized = ((Math.floor(hour) % 24) + 24) % 24
  if (from === to) return true
  return from < to
    ? normalized >= from && normalized < to
    : normalized >= from || normalized < to
}

/**
 * Normalize a `when` rule (untrusted JSON may be partially invalid).
 *
 * Unknown keys and invalid values are dropped; a rule with no usable condition
 * returns undefined, which makes the phrase unconditional rather than "never
 * matches" (mirrors the original normalizeWhen).
 */
export function normalizeWhen(when: WhenCondition | undefined | null): WhenCondition | undefined {
  if (when === null || typeof when !== 'object' || Array.isArray(when)) return undefined
  const source = when as Readonly<Record<string, unknown>>
  const out: Record<string, unknown> = {}

  const rawTool = source.tool
  if (typeof rawTool === 'string') {
    if (rawTool.length > 0 && rawTool.length <= 64) out.tool = rawTool
  } else if (Array.isArray(rawTool)) {
    const tools = rawTool.filter((name): name is string =>
      typeof name === 'string' && name.length > 0 && name.length <= 64)
    if (tools.length > 0) out.tool = tools
  }

  for (const key of ['retry', 'firstTurn'] as const) {
    if (typeof source[key] === 'boolean') out[key] = source[key]
  }

  const rawPending = source.pending
  if (typeof rawPending === 'boolean') out.pending = rawPending
  else if (typeof rawPending === 'number' && Number.isFinite(rawPending) && rawPending >= 0) {
    out.pending = Math.floor(rawPending)
  }

  const rawPhase = source.phase
  const isPhase = (value: unknown): value is string =>
    typeof value === 'string' && PHASE_VALUES.includes(value)
  if (isPhase(rawPhase)) out.phase = rawPhase
  else if (Array.isArray(rawPhase)) {
    const phases = rawPhase.filter(isPhase)
    if (phases.length > 0) out.phase = phases
  }

  const rawHour = source.hour
  if (Array.isArray(rawHour)
    && rawHour.length === 2
    && rawHour.every(value => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 23)) {
    out.hour = [rawHour[0] as number, rawHour[1] as number]
  }

  return Object.keys(out).length > 0 ? (out as WhenCondition) : undefined
}

/** Whether a normalized `when` rule matches the live facts (AND across fields). */
function matchNormalizedWhen(rule: WhenCondition, live: LiveContext): boolean {
  const ctx = live !== null && typeof live === 'object' ? live : ({} as LiveContext)

  if (rule.tool !== undefined) {
    const running = Array.isArray(ctx.tool)
      ? ctx.tool.filter((name): name is string => typeof name === 'string' && name.length > 0)
      : []
    if (running.length === 0) return false
    if (rule.tool !== '*') {
      const wanted = Array.isArray(rule.tool) ? rule.tool : [rule.tool]
      if (!running.some(name => wanted.includes(name))) return false
    }
  }

  if (rule.retry !== undefined) {
    const retrying = typeof ctx.retry === 'number' && Number.isFinite(ctx.retry) && ctx.retry > 0
    if (rule.retry !== retrying) return false
  }

  if (rule.pending !== undefined) {
    const pending = typeof ctx.pending === 'number' && Number.isFinite(ctx.pending)
      ? Math.max(0, Math.floor(ctx.pending))
      : 0
    if (typeof rule.pending === 'boolean') {
      if (rule.pending !== (pending > 0)) return false
    } else if (!(pending >= rule.pending)) {
      return false
    }
  }

  if (rule.phase !== undefined) {
    const wanted = Array.isArray(rule.phase) ? rule.phase : [rule.phase]
    if (!wanted.includes(ctx.phase)) return false
  }

  if (rule.hour !== undefined) {
    const hour = typeof ctx.hour === 'number' && Number.isFinite(ctx.hour) ? ctx.hour : Number.NaN
    if (!hourInWindow(rule.hour, hour)) return false
  }

  if (rule.firstTurn !== undefined && rule.firstTurn !== (ctx.firstTurn === true)) return false

  return true
}

/**
 * Whether a `when` rule matches the live facts (pure helper, exported for tests
 * and for callers that want to pre-filter pools themselves).
 */
export function matchWhen(when: WhenCondition | undefined | null, live: LiveContext): boolean {
  const rule = normalizeWhen(when)
  return rule === undefined ? false : matchNormalizedWhen(rule, live)
}

/**
 * Select the candidate pool for one draw: rarity gate first, then conditional
 * priority (matching conditionals > plain entries > full eligible pool).
 * Exported as a pure building block; the engine calls it with its injected rng.
 */
export function selectCandidatePool(
  entries: readonly PhraseEntry[],
  live: LiveContext,
  rng: () => number,
): readonly PhraseEntry[] {
  if (!Array.isArray(entries) || entries.length === 0) return []
  const random = typeof rng === 'function' ? rng : Math.random
  const valid = entries.filter((entry): entry is PhraseEntry =>
    entry !== null && typeof entry === 'object' && typeof entry.text === 'string' && entry.text.length > 0)
  if (valid.length === 0) return []

  const rolled: PhraseEntry[] = []
  for (const entry of valid) {
    const rarity = normalizeRarity(entry.rarity)
    if (rarity === undefined || rarity >= 1 || random() < rarity) rolled.push(entry)
  }
  const eligible = rolled.length > 0 ? rolled : valid

  const conditional: PhraseEntry[] = []
  const plain: PhraseEntry[] = []
  for (const entry of eligible) {
    const rule = normalizeWhen(entry.when)
    if (rule === undefined) plain.push(entry)
    else if (matchNormalizedWhen(rule, live)) conditional.push(entry)
  }

  if (conditional.length > 0) return conditional
  return plain.length > 0 ? plain : eligible
}

/** Options for {@link createSelectionEngine}. */
export interface SelectionEngineOptions {
  /** Random source in [0, 1); defaults to Math.random. Injected for tests. */
  readonly rng?: () => number
}

/**
 * Create the stateful selector: one shuffle bag and one recency list per
 * language+phase key, both serializable through snapshot()/restore().
 */
export function createSelectionEngine(options: SelectionEngineOptions = {}): SelectionEngine {
  const rng = typeof options.rng === 'function' ? options.rng : Math.random
  const bags = new Map<string, string[]>()
  const recent = new Map<string, string[]>()

  /** Next random value, clamped so a hostile injected rng cannot index out of bounds. */
  const random = (): number => {
    const value = rng()
    if (typeof value !== 'number' || !Number.isFinite(value)) return 0
    if (value <= 0) return 0
    if (value >= 1) return 1 - Number.EPSILON
    return value
  }

  const normalizeRecentLimit = (value: unknown): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_RECENT_LIMIT
    return Math.min(MAX_RECENT_LIMIT, Math.max(0, Math.floor(value)))
  }

  /** Trim every remembered list down to the current limit (config changes apply immediately). */
  const trimRecent = (limit: number): void => {
    for (const [key, list] of recent) {
      if (list.length > limit) recent.set(key, list.slice(0, limit))
    }
  }

  /** Restart a bag, dropping the most recent texts first so bag seams do not repeat. */
  const refill = (key: string, texts: readonly string[], limit: number): string[] => {
    if (limit > 0) {
      const remembered = recent.get(key) ?? []
      const kept = texts.filter(text => remembered.indexOf(text) < 0)
      if (kept.length > 0) return kept
    }
    return texts.slice()
  }

  /** Weighted pick (original semantics: one rng() call, last item absorbs rounding). */
  const pickWeighted = (pool: readonly PhraseEntry[]): PhraseEntry | undefined => {
    if (pool.length === 0) return undefined
    if (pool.length === 1) return pool[0]
    const items: { entry: PhraseEntry; weight: number }[] = []
    let total = 0
    for (const entry of pool) {
      const weight = normalizePhraseWeight(entry.weight)
      items.push({ entry, weight })
      total += weight
    }
    let remaining = random() * total
    for (const item of items) {
      remaining -= item.weight
      if (remaining <= 0) return item.entry
    }
    return items[items.length - 1]?.entry
  }

  /** Uniform pick. */
  const pickUniform = (pool: readonly PhraseEntry[]): PhraseEntry | undefined => {
    if (pool.length === 0) return undefined
    if (pool.length === 1) return pool[0]
    const index = Math.min(pool.length - 1, Math.floor(random() * pool.length))
    return pool[index]
  }

  const pick = (request: PickRequest): PhrasePick | undefined => {
    if (request === null || typeof request !== 'object') return undefined
    const live = request.live
    if (live === null || typeof live !== 'object') return undefined
    const bank = request.bank as MergedBank | undefined
    // Structural reads: a malformed bank means "no phrase", never a throw.
    const languageGroup = bank === null || bank === undefined || typeof bank !== 'object'
      ? undefined
      : (bank as unknown as Record<string, unknown>)[String(live.lang)]
    const phaseEntries = languageGroup !== null && typeof languageGroup === 'object'
      ? (languageGroup as Record<string, unknown>)[String(live.phase)]
      : undefined
    if (!Array.isArray(phaseEntries) || phaseEntries.length === 0) return undefined

    const candidatePool = selectCandidatePool(phaseEntries as readonly PhraseEntry[], live, random)
    if (candidatePool.length === 0) return undefined

    const key = String(live.lang) + '|' + String(live.phase)
    const limit = normalizeRecentLimit(request.antiRepeatRecentLimit)
    trimRecent(limit)

    const texts: string[] = []
    for (const entry of candidatePool) {
      const text = entry.text
      if (typeof text === 'string' && text.length > 0 && texts.indexOf(text) < 0) texts.push(text)
    }
    if (texts.length === 0) return undefined

    let bag = bags.get(key)
    if (bag === undefined || bag.length === 0 || bag.some(text => texts.indexOf(text) < 0)) {
      bag = refill(key, texts, limit)
    }
    const remaining = new Set(bag)
    const narrowed = candidatePool.filter(entry => remaining.has(entry.text))
    const drawPool = narrowed.length > 0 ? narrowed : candidatePool

    const picked = request.weighted === false ? pickUniform(drawPool) : pickWeighted(drawPool)
    if (picked === undefined) return undefined

    bags.set(key, bag.filter(text => text !== picked.text))
    const remembered = (recent.get(key) ?? []).filter(text => text !== picked.text)
    remembered.unshift(picked.text)
    recent.set(key, remembered.slice(0, limit))

    return {
      text: picked.text,
      weight: normalizePhraseWeight(picked.weight),
      rarity: normalizeRarity(picked.rarity) !== undefined,
    }
  }

  const reset = (): void => {
    bags.clear()
    recent.clear()
  }

  const snapshot = (): SelectionSnapshot => {
    const bagOut: Record<string, readonly string[]> = {}
    const recentOut: Record<string, readonly string[]> = {}
    const keys = new Set<string>([...bags.keys(), ...recent.keys()])
    for (const key of keys) {
      bagOut[key] = (bags.get(key) ?? []).slice()
      recentOut[key] = (recent.get(key) ?? []).slice()
    }
    return { bags: bagOut, recent: recentOut }
  }

  const restore = (state: SelectionSnapshot): void => {
    bags.clear()
    recent.clear()
    if (state === null || typeof state !== 'object') return
    const readList = (value: unknown): string[] =>
      Array.isArray(value) ? value.filter((text): text is string => typeof text === 'string') : []
    const bagState = (state as { readonly bags?: unknown }).bags
    if (bagState !== null && typeof bagState === 'object') {
      for (const [key, value] of Object.entries(bagState as Record<string, unknown>)) {
        const list = readList(value)
        if (list.length > 0) bags.set(key, list)
      }
    }
    const recentState = (state as { readonly recent?: unknown }).recent
    if (recentState !== null && typeof recentState === 'object') {
      for (const [key, value] of Object.entries(recentState as Record<string, unknown>)) {
        const list = readList(value)
        if (list.length > 0) recent.set(key, list)
      }
    }
  }

  return { pick, reset, snapshot, restore }
}
