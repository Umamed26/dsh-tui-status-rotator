/**
 * Engine tests for the selection pipeline: shuffle bag, anti-repeat, weighted
 * and uniform draws, when-conditions, rarity gate, snapshot/restore.
 *
 * Tests import the BUILT output (lib/types/engine/*.js); package.json's test
 * script builds first. Types are imported type-only from lib/types/types.js.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createSelectionEngine,
  matchWhen,
  normalizeWhen,
  selectCandidatePool,
  normalizePhraseWeight,
  normalizeRarity,
  hourInWindow,
  MAX_PHRASE_WEIGHT,
  MAX_RECENT_LIMIT,
  DEFAULT_RECENT_LIMIT,
} from '../../lib/types/engine/selection.js'
import type {
  Lang,
  LiveContext,
  MergedBank,
  Phase,
  PhraseEntry,
  PhrasePick,
  PickRequest,
  SelectionSnapshot,
  WhenCondition,
} from '../../lib/types/types.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Live facts with deterministic defaults; override one field per test. */
function live(overrides: Partial<LiveContext> = {}): LiveContext {
  return {
    lang: 'zh',
    phase: 'running',
    now: 1_700_000_000_000,
    hour: 12,
    elapsedMs: 0,
    running: true,
    tool: [],
    retry: 0,
    pending: 0,
    firstTurn: false,
    ...overrides,
  }
}

/** One normalized phrase entry. */
function entry(text: string, extra: { weight?: number; when?: WhenCondition; rarity?: number } = {}): PhraseEntry {
  const out: { text: string; weight: number; when?: WhenCondition; rarity?: number } = {
    text,
    weight: extra.weight === undefined ? 1 : extra.weight,
  }
  if (extra.when !== undefined) out.when = extra.when
  if (extra.rarity !== undefined) out.rarity = extra.rarity
  return out
}

/** A normalized bank; unspecified phase/language groups are empty. */
function bankOf(groups: {
  zh?: Partial<Record<Phase, readonly PhraseEntry[]>>
  en?: Partial<Record<Phase, readonly PhraseEntry[]>>
} = {}): MergedBank {
  const empty = (): Record<Phase, readonly PhraseEntry[]> => ({ thinking: [], running: [], long: [] })
  return {
    zh: { ...empty(), ...(groups.zh ?? {}) },
    en: { ...empty(), ...(groups.en ?? {}) },
    includedPacks: [],
    warnings: [],
  }
}

/** One pick request. */
function request(bank: MergedBank, overrides: Partial<Omit<PickRequest, 'bank'>> = {}): PickRequest {
  const out: PickRequest = {
    bank,
    live: overrides.live === undefined ? live() : overrides.live,
    weighted: overrides.weighted === undefined ? true : overrides.weighted,
    antiRepeatRecentLimit: overrides.antiRepeatRecentLimit === undefined ? 3 : overrides.antiRepeatRecentLimit,
  }
  return out
}

/** rng that cycles through fixed values. */
function sequenceRng(values: readonly number[]): () => number {
  let index = 0
  return () => {
    const value = values[index % values.length]
    index += 1
    return value === undefined ? 0 : value
  }
}

/** rng that always returns the same value. */
function constantRng(value: number): () => number {
  return () => value
}

/** Deterministic PRNG (mulberry32) for distribution tests. */
function seededRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Draw n phrases and project them to text. */
function draw(
  engine: ReturnType<typeof createSelectionEngine>,
  bank: MergedBank,
  count: number,
  overrides: Partial<Omit<PickRequest, 'bank'>> = {},
): string[] {
  const out: string[] = []
  for (let index = 0; index < count; index++) {
    const pick: PhrasePick | undefined = engine.pick(request(bank, overrides))
    out.push(pick === undefined ? '<none>' : pick.text)
  }
  return out
}

// ---------------------------------------------------------------------------
// Shuffle bag + anti-repeat
// ---------------------------------------------------------------------------

test('constants match the original plugin', () => {
  assert.equal(MAX_PHRASE_WEIGHT, 1000)
  assert.equal(MAX_RECENT_LIMIT, 50)
  assert.equal(DEFAULT_RECENT_LIMIT, 3)
})

test('shuffle bag never repeats within one round', () => {
  const engine = createSelectionEngine({ rng: constantRng(0) })
  const bank = bankOf({ zh: { running: [entry('a'), entry('b'), entry('c')] } })
  assert.deepEqual(draw(engine, bank, 6), ['a', 'b', 'c', 'a', 'b', 'c'])
})

test('bag seam never repeats the last antiRepeatRecentLimit phrases', () => {
  const engine = createSelectionEngine({ rng: constantRng(0) })
  const bank = bankOf({ zh: { running: [entry('a'), entry('b'), entry('c'), entry('d')] } })
  const sequence = draw(engine, bank, 12, { antiRepeatRecentLimit: 2 })
  assert.deepEqual(sequence.slice(0, 8), ['a', 'b', 'c', 'd', 'a', 'b', 'c', 'd'])
  for (let index = 0; index < sequence.length; index++) {
    const recent = sequence.slice(Math.max(0, index - 2), index)
    assert.ok(!recent.includes(sequence[index]), 'repeat at ' + index + ': ' + sequence.join(','))
  }
})

test('antiRepeatRecentLimit=0 only guarantees no repeat inside a bag', () => {
  const engine = createSelectionEngine({ rng: constantRng(0) })
  const bank = bankOf({ zh: { running: [entry('a'), entry('b')] } })
  assert.deepEqual(draw(engine, bank, 4, { antiRepeatRecentLimit: 0 }), ['a', 'b', 'a', 'b'])
})

test('changed candidate pool restarts the bag (no stale phrase)', () => {
  const engine = createSelectionEngine({ rng: constantRng(0) })
  assert.deepEqual(draw(engine, bankOf({ zh: { running: [entry('a'), entry('b'), entry('c')] } }), 2), ['a', 'b'])
  // Same language+phase key, different pool (e.g. a condition came and went).
  assert.deepEqual(draw(engine, bankOf({ zh: { running: [entry('x'), entry('y')] } }), 2), ['x', 'y'])
})

test('bags are independent per language and phase', () => {
  const engine = createSelectionEngine({ rng: constantRng(0) })
  const bank = bankOf({
    zh: { thinking: [entry('t1')], running: [entry('r1')] },
    en: { thinking: [entry('t2')] },
  })
  assert.equal(engine.pick(request(bank, { live: live({ phase: 'thinking' }) }))?.text, 't1')
  assert.equal(engine.pick(request(bank, { live: live({ phase: 'running' }) }))?.text, 'r1')
  assert.equal(engine.pick(request(bank, { live: live({ lang: 'en', phase: 'thinking' }) }))?.text, 't2')
  const snapshot = engine.snapshot()
  assert.deepEqual(Object.keys(snapshot.bags).sort(), ['en|thinking', 'zh|running', 'zh|thinking'])
})

test('recent memory is clamped to 0..50 and truncated on shrink', () => {
  const phrases = Array.from({ length: 60 }, (_, index) => entry('p' + index))
  const engine = createSelectionEngine({ rng: constantRng(0) })
  draw(engine, bankOf({ zh: { running: phrases } }), 60, { antiRepeatRecentLimit: 999 })
  assert.equal(engine.snapshot().recent['zh|running']?.length, MAX_RECENT_LIMIT)

  const shrinking = createSelectionEngine({ rng: constantRng(0) })
  draw(shrinking, bankOf({ zh: { running: phrases } }), 5, { antiRepeatRecentLimit: 4 })
  assert.equal(shrinking.snapshot().recent['zh|running']?.length, 4)
  draw(shrinking, bankOf({ zh: { running: phrases } }), 1, { antiRepeatRecentLimit: 1 })
  assert.equal(shrinking.snapshot().recent['zh|running']?.length, 1)
  draw(shrinking, bankOf({ zh: { running: phrases } }), 1, { antiRepeatRecentLimit: -3 })
  assert.equal(shrinking.snapshot().recent['zh|running']?.length, 0)
})

// ---------------------------------------------------------------------------
// Weighted / uniform draws
// ---------------------------------------------------------------------------

test('weights are clamped to 1..1000 (invalid counts as 1)', () => {
  assert.equal(normalizePhraseWeight(1), 1)
  assert.equal(normalizePhraseWeight(3), 3)
  assert.equal(normalizePhraseWeight(1000), 1000)
  assert.equal(normalizePhraseWeight(5000), 1000)
  assert.equal(normalizePhraseWeight(0), 1)
  assert.equal(normalizePhraseWeight(-2), 1)
  assert.equal(normalizePhraseWeight(Number.NaN), 1)
  assert.equal(normalizePhraseWeight('3'), 1)
  assert.equal(normalizePhraseWeight(undefined), 1)
})

test('weighted draw picks by weight (rng pins the position)', () => {
  const bank = bankOf({ zh: { running: [entry('a', { weight: 1 }), entry('b', { weight: 9 })] } })
  const high = createSelectionEngine({ rng: constantRng(0.99) })
  assert.deepEqual(draw(high, bank, 4), ['b', 'a', 'b', 'a'])
  const low = createSelectionEngine({ rng: constantRng(0) })
  assert.deepEqual(draw(low, bank, 4), ['a', 'b', 'a', 'b'])
})

test('weighted=false draws uniformly regardless of weight', () => {
  const bank = bankOf({ zh: { running: [entry('a', { weight: 1000 }), entry('b', { weight: 1 })] } })
  const uniform = createSelectionEngine({ rng: constantRng(0.5) })
  assert.equal(uniform.pick(request(bank, { weighted: false }))?.text, 'b')
  const weighted = createSelectionEngine({ rng: constantRng(0.5) })
  assert.equal(weighted.pick(request(bank, { weighted: true }))?.text, 'a')
})

test('weighted first draw follows the weight ratio (seeded rng)', () => {
  const bank = bankOf({ zh: { running: [entry('a', { weight: 1 }), entry('b', { weight: 9 })] } })
  const engine = createSelectionEngine({ rng: seededRng(42) })
  let b = 0
  const trials = 2000
  for (let index = 0; index < trials; index++) {
    engine.reset()
    const pick = engine.pick(request(bank, { antiRepeatRecentLimit: 0 }))
    if (pick?.text === 'b') b += 1
  }
  // Expected ~90%; the shuffle bag guarantees exactly one of each per round,
  // so only the *first* draw of a fresh bag shows the weighting.
  assert.ok(b > trials * 0.82, 'weighted b count too low: ' + b)
  assert.ok(b < trials * 0.98, 'weighted b count too high: ' + b)
})

test('PhrasePick reports the clamped weight and the rarity flag', () => {
  const bank = bankOf({ zh: { running: [entry('heavy', { weight: 5000 }), entry('rare', { rarity: 1 })] } })
  const engine = createSelectionEngine({ rng: constantRng(0.99) })
  const pick = engine.pick(request(bank))
  assert.ok(pick !== undefined)
  const rarePick = engine.pick(request(bankOf({ zh: { running: [entry('rare', { rarity: 1 })] } })))
  assert.equal(rarePick?.rarity, true)
  assert.equal(rarePick?.weight, 1)
  const plainPick = engine.pick(request(bankOf({ zh: { running: [entry('plain')] } })))
  assert.equal(plainPick?.rarity, false)
})

// ---------------------------------------------------------------------------
// when-condition filtering (conditional priority)
// ---------------------------------------------------------------------------

test('matching conditionals take priority over a huge plain pool', () => {
  const plain = Array.from({ length: 100 }, (_, index) => entry('plain-' + index))
  const conditional = entry('bash-running', { when: { tool: 'bash' } })
  const pool = [...plain, conditional]
  const bank = bankOf({ zh: { running: pool } })
  const engine = createSelectionEngine({ rng: constantRng(0.4) })
  assert.deepEqual(draw(engine, bank, 5, { live: live({ tool: ['bash'] }) }), Array(5).fill('bash-running'))
})

test('no matching conditional falls back to the plain phrases', () => {
  const bank = bankOf({
    zh: { running: [entry('p1'), entry('p2'), entry('cond', { when: { tool: 'web_search' } })] },
  })
  const engine = createSelectionEngine({ rng: constantRng(0) })
  assert.deepEqual(draw(engine, bank, 4, { live: live({ tool: [] }) }), ['p1', 'p2', 'p1', 'p2'])
})

test('all conditional and none matching falls back to the full eligible pool', () => {
  const bank = bankOf({ zh: { running: [entry('cond', { when: { tool: 'web_search' } })] } })
  const engine = createSelectionEngine({ rng: constantRng(0) })
  assert.deepEqual(draw(engine, bank, 2, { live: live({ tool: [] }) }), ['cond', 'cond'])
})

test('when conditions are AND-ed inside one entry', () => {
  const bank = bankOf({
    zh: { running: [entry('plain'), entry('combo', { when: { tool: 'bash', pending: true } })] },
  })
  const partial = createSelectionEngine({ rng: constantRng(0) })
  assert.deepEqual(draw(partial, bank, 1, { live: live({ tool: ['bash'], pending: 0 }) }), ['plain'])
  const full = createSelectionEngine({ rng: constantRng(0) })
  assert.deepEqual(draw(full, bank, 1, { live: live({ tool: ['bash'], pending: 1 }) }), ['combo'])
})

// ---------------------------------------------------------------------------
// Rarity gate
// ---------------------------------------------------------------------------

test('rarity rolls once per gated entry and only that fraction participates', () => {
  const pool = [entry('plain'), entry('rare', { rarity: 0.5 })]
  const base = live()
  assert.deepEqual(selectCandidatePool(pool, base, constantRng(0.4)).map(item => item.text), ['plain', 'rare'])
  assert.deepEqual(selectCandidatePool(pool, base, constantRng(0.6)).map(item => item.text), ['plain'])
})

test('rarity that filters the whole pool falls back to the full pool', () => {
  const pool = [entry('rare', { rarity: 0.1 })]
  assert.deepEqual(selectCandidatePool(pool, live(), constantRng(0.9)).map(item => item.text), ['rare'])
})

test('rarity=1 never consumes randomness', () => {
  const throwing = () => {
    throw new Error('rng must not be called for rarity 1')
  }
  const pool = [entry('guaranteed', { rarity: 1 })]
  assert.deepEqual(selectCandidatePool(pool, live(), throwing).map(item => item.text), ['guaranteed'])
})

test('normalizeRarity accepts only (0, 1]', () => {
  assert.equal(normalizeRarity(0), undefined)
  assert.equal(normalizeRarity(-0.5), undefined)
  assert.equal(normalizeRarity(1.5), undefined)
  assert.equal(normalizeRarity(0.5), 0.5)
  assert.equal(normalizeRarity(1), 1)
  assert.equal(normalizeRarity('0.5'), undefined)
})

// ---------------------------------------------------------------------------
// matchWhen / normalizeWhen (ported assertions from the original verify script)
// ---------------------------------------------------------------------------

test('matchWhen: no condition never matches', () => {
  assert.equal(matchWhen(undefined, live()), false)
  assert.equal(matchWhen(null, live()), false)
  assert.equal(matchWhen({}, live()), false)
  assert.equal(matchWhen({ nope: 1 } as unknown as WhenCondition, live()), false)
})

test('matchWhen: tool string, array and wildcard', () => {
  assert.equal(matchWhen({ tool: 'bash' }, live({ tool: ['bash'] })), true)
  assert.equal(matchWhen({ tool: 'bash' }, live({ tool: ['web_search'] })), false)
  assert.equal(matchWhen({ tool: ['bash', 'read'] }, live({ tool: ['read'] })), true)
  assert.equal(matchWhen({ tool: '*' }, live({ tool: ['anything'] })), true)
  assert.equal(matchWhen({ tool: '*' }, live({ tool: [] })), false)
  assert.equal(matchWhen({ tool: 'bash' }, live({ tool: [] })), false)
})

test('matchWhen: retry uses "retry > 0" and supports false', () => {
  assert.equal(matchWhen({ retry: true }, live({ retry: 2 })), true)
  assert.equal(matchWhen({ retry: true }, live({ retry: 0 })), false)
  assert.equal(matchWhen({ retry: false }, live({ retry: 0 })), true)
  assert.equal(matchWhen({ retry: false }, live({ retry: 1 })), false)
})

test('matchWhen: pending boolean and numeric thresholds', () => {
  assert.equal(matchWhen({ pending: true }, live({ pending: 1 })), true)
  assert.equal(matchWhen({ pending: true }, live({ pending: 0 })), false)
  assert.equal(matchWhen({ pending: 2 }, live({ pending: 2 })), true)
  assert.equal(matchWhen({ pending: 2 }, live({ pending: 1 })), false)
  assert.equal(matchWhen({ pending: false }, live({ pending: 0 })), true)
})

test('matchWhen: phase single value and list', () => {
  assert.equal(matchWhen({ phase: 'long' }, live({ phase: 'long' })), true)
  assert.equal(matchWhen({ phase: ['thinking', 'long'] }, live({ phase: 'long' })), true)
  assert.equal(matchWhen({ phase: 'long' }, live({ phase: 'running' })), false)
  assert.equal(matchWhen({ phase: ['thinking'] }, live({ phase: 'running' })), false)
})

test('matchWhen: hour window is inclusive start, exclusive end', () => {
  assert.equal(matchWhen({ hour: [9, 17] }, live({ hour: 9 })), true)
  assert.equal(matchWhen({ hour: [9, 17] }, live({ hour: 16 })), true)
  assert.equal(matchWhen({ hour: [9, 17] }, live({ hour: 17 })), false)
  assert.equal(matchWhen({ hour: [9, 17] }, live({ hour: 8 })), false)
})

test('matchWhen: hour window wraps midnight, equal bounds mean all day', () => {
  assert.equal(matchWhen({ hour: [22, 6] }, live({ hour: 23 })), true)
  assert.equal(matchWhen({ hour: [22, 6] }, live({ hour: 5 })), true)
  assert.equal(matchWhen({ hour: [22, 6] }, live({ hour: 6 })), false)
  assert.equal(matchWhen({ hour: [22, 6] }, live({ hour: 12 })), false)
  assert.equal(matchWhen({ hour: [0, 0] }, live({ hour: 13 })), true)
})

test('matchWhen: firstTurn, alone and AND-ed with other fields', () => {
  assert.equal(matchWhen({ firstTurn: true }, live({ firstTurn: true })), true)
  assert.equal(matchWhen({ firstTurn: true }, live({ firstTurn: false })), false)
  assert.equal(matchWhen({ firstTurn: false }, live({ firstTurn: false })), true)
  assert.equal(matchWhen({ tool: 'bash', phase: 'long' }, live({ tool: ['bash'], phase: 'long' })), true)
  assert.equal(matchWhen({ tool: 'bash', phase: 'long' }, live({ tool: ['bash'], phase: 'running' })), false)
})

test('conditions fail closed when live facts are missing', () => {
  const empty = {} as LiveContext
  assert.equal(matchWhen({ tool: 'bash' }, empty), false)
  assert.equal(matchWhen({ pending: true }, empty), false)
  assert.equal(matchWhen({ hour: [0, 0] }, empty), false)
  assert.equal(matchWhen({ retry: false }, empty), true)
  assert.equal(matchWhen({ firstTurn: false }, empty), true)
})

test('hourInWindow helper', () => {
  assert.equal(hourInWindow([9, 17], 9), true)
  assert.equal(hourInWindow([9, 17], 17), false)
  assert.equal(hourInWindow([22, 6], 23), true)
  assert.equal(hourInWindow([0, 0], 23), true)
  assert.equal(hourInWindow([9, 17], Number.NaN), false)
})

test('normalizeWhen drops invalid values and unknown keys', () => {
  assert.equal(normalizeWhen({ nope: 1 } as unknown as WhenCondition), undefined)
  assert.deepEqual(normalizeWhen({ tool: 'bash', hour: [25, 3], nope: 1 } as unknown as WhenCondition), { tool: 'bash' })
  assert.equal(normalizeWhen({ hour: [1.5, 3] } as unknown as WhenCondition), undefined)
  assert.equal(normalizeWhen({ hour: [0, 24] } as unknown as WhenCondition), undefined)
  assert.equal(normalizeWhen({ hour: [1] } as unknown as WhenCondition), undefined)
  assert.deepEqual(normalizeWhen({ pending: 2.7 }), { pending: 2 })
  assert.deepEqual(normalizeWhen({ tool: ['bash', '', 42] } as unknown as WhenCondition), { tool: ['bash'] })
  assert.deepEqual(normalizeWhen({ phase: ['long', 'nope'] } as unknown as WhenCondition), { phase: ['long'] })
  assert.equal(normalizeWhen('bash' as unknown as WhenCondition), undefined)
})

// ---------------------------------------------------------------------------
// snapshot / restore
// ---------------------------------------------------------------------------

test('snapshot/restore round-trips exactly', () => {
  const engine = createSelectionEngine({ rng: constantRng(0) })
  const bank = bankOf({ zh: { running: [entry('a'), entry('b'), entry('c'), entry('d')] } })
  draw(engine, bank, 3)
  const snapshot = engine.snapshot()
  assert.equal(snapshot.recent['zh|running']?.length, 3)
  const restored = createSelectionEngine({ rng: constantRng(0) })
  restored.restore(snapshot)
  assert.deepEqual(restored.snapshot(), snapshot)
})

test('restored memory continues the rotation (no immediate repeat)', () => {
  const bank = bankOf({ zh: { running: [entry('a'), entry('b'), entry('c'), entry('d')] } })
  const first = createSelectionEngine({ rng: constantRng(0) })
  assert.deepEqual(draw(first, bank, 3), ['a', 'b', 'c'])
  const snapshot: SelectionSnapshot = first.snapshot()

  const restored = createSelectionEngine({ rng: constantRng(0) })
  restored.restore(snapshot)
  const continued = draw(restored, bank, 4)
  assert.notEqual(continued[0], 'c')
  const reference = createSelectionEngine({ rng: constantRng(0) })
  reference.restore(snapshot)
  assert.deepEqual(draw(reference, bank, 4), continued)
})

test('restore ignores corrupt state and reset clears memory', () => {
  const engine = createSelectionEngine({ rng: constantRng(0) })
  assert.doesNotThrow(() => engine.restore(null as unknown as SelectionSnapshot))
  assert.doesNotThrow(() => engine.restore({} as SelectionSnapshot))
  assert.doesNotThrow(() => engine.restore({ bags: { 'zh|running': 'nope' }, recent: null } as unknown as SelectionSnapshot))
  const bank = bankOf({ zh: { running: [entry('a'), entry('b')] } })
  draw(engine, bank, 2)
  engine.reset()
  assert.deepEqual(engine.snapshot(), { bags: {}, recent: {} })
  assert.deepEqual(draw(engine, bank, 2), ['a', 'b'])
})

// ---------------------------------------------------------------------------
// Defensive behaviour
// ---------------------------------------------------------------------------

test('empty or malformed banks yield undefined, never a throw', () => {
  const engine = createSelectionEngine({ rng: constantRng(0) })
  assert.equal(engine.pick(request(bankOf())), undefined)
  assert.equal(engine.pick(request({} as MergedBank)), undefined)
  assert.equal(engine.pick(request(null as unknown as MergedBank)), undefined)
  assert.equal(engine.pick(null as unknown as PickRequest), undefined)
  const wrongLanguage = bankOf({ en: { running: [entry('x')] } })
  assert.equal(engine.pick(request(wrongLanguage, { live: live({ lang: 'zh' as Lang }) })), undefined)
})

test('pick selects the language+phase group', () => {
  const bank = bankOf({
    zh: { thinking: [entry('zh-thinking')], running: [entry('zh-running')], long: [entry('zh-long')] },
    en: { running: [entry('en-running')] },
  })
  const engine = createSelectionEngine({ rng: constantRng(0) })
  assert.equal(engine.pick(request(bank, { live: live({ phase: 'thinking' }) }))?.text, 'zh-thinking')
  assert.equal(engine.pick(request(bank, { live: live({ phase: 'long' }) }))?.text, 'zh-long')
  assert.equal(engine.pick(request(bank, { live: live({ lang: 'en', phase: 'running' }) }))?.text, 'en-running')
})
