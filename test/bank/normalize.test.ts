/**
 * Normalization + merge semantics, ported from dsh-status-rotator's
 * \`normalizeEntry\` / \`normalizeGroups\` / \`mergeGroups\` / \`mergePackChain\`
 * (README_ZH "词库包" / "加权随机" / "条件句与稀有句").
 *
 * The web client treated the bank as trusted (node half rejected bad
 * documents); the TUI port also loads a hand-edited external file, so these
 * tests pin the hardened, never-throwing behavior: invalid entries are
 * dropped with a BankWarning instead of silently changing the copy.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  MAX_PHRASE_CODE_POINTS,
  MAX_PHRASE_WEIGHT,
  mergeBank,
  mergePhaseEntries,
  normalizeBankDoc,
  normalizePackInput,
  normalizePhraseGroups,
  normalizePhraseInput,
} from '../../lib/types/bank/normalize.js'

/** Codes of the warnings produced for one call. */
function codes(warnings) {
  return warnings.map((warning) => warning.code)
}

// ---------------------------------------------------------------------------
// normalizePhraseInput
// ---------------------------------------------------------------------------

test('normalizePhraseInput: string becomes weight-1 entry and copy is preserved', () => {
  assert.deepEqual(normalizePhraseInput('正在写代码…'), { text: '正在写代码…', weight: 1 })
  assert.deepEqual(normalizePhraseInput('  padded  '), { text: '  padded  ', weight: 1 })
})

test('normalizePhraseInput: invalid values return undefined', () => {
  for (const value of [undefined, null, 42, true, [], '', '   ', { text: '' }, { text: '   ' }, { text: 42 }, {}]) {
    assert.equal(normalizePhraseInput(value), undefined, 'should reject ' + JSON.stringify(value))
  }
})

test('normalizePhraseInput: weight is clamped to 1..1000 like the original', () => {
  assert.equal(normalizePhraseInput({ text: 'a', weight: 3 }).weight, 3)
  assert.equal(normalizePhraseInput({ text: 'a', weight: 2.5 }).weight, 2.5)
  assert.equal(normalizePhraseInput({ text: 'a', weight: MAX_PHRASE_WEIGHT + 1 }).weight, MAX_PHRASE_WEIGHT)
  for (const weight of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '3', null]) {
    assert.equal(normalizePhraseInput({ text: 'a', weight }).weight, 1, 'illegal weight degrades to 1 (README)')
  }
})

test('normalizePhraseInput: rarity is kept only inside (0, 1]', () => {
  assert.equal(normalizePhraseInput({ text: 'a', rarity: 0.01 }).rarity, 0.01)
  assert.equal(normalizePhraseInput({ text: 'a', rarity: 1 }).rarity, 1)
  for (const rarity of [0, -0.5, 1.5, Number.NaN, 'x', null]) {
    assert.equal(normalizePhraseInput({ text: 'a', rarity }).rarity, undefined, 'invalid rarity is dropped')
  }
})

test('normalizePhraseInput: valid when conditions survive', () => {
  const entry = normalizePhraseInput({
    text: '正在敲命令…',
    weight: 2,
    when: { tool: ['bash', 'web_search'], retry: true, pending: 2.9, phase: ['thinking', 'long'], hour: [22, 6], firstTurn: false },
  })
  assert.deepEqual(entry, {
    text: '正在敲命令…',
    weight: 2,
    when: { tool: ['bash', 'web_search'], retry: true, pending: 2, phase: ['thinking', 'long'], hour: [22, 6], firstTurn: false },
  })
  assert.deepEqual(normalizePhraseInput({ text: 'a', when: { tool: '*' } }).when, { tool: '*' })
  assert.deepEqual(normalizePhraseInput({ text: 'a', when: { pending: true } }).when, { pending: true })
})

test('normalizePhraseInput: when.phase accepts idle for compatibility (never matches a TUI phase)', () => {
  assert.deepEqual(normalizePhraseInput({ text: 'a', when: { phase: 'idle' } }).when, { phase: 'idle' })
  assert.deepEqual(normalizePhraseInput({ text: 'a', when: { phase: ['idle', 'running'] } }).when, { phase: ['idle', 'running'] })
})

test('normalizePhraseInput: invalid when drops the entry instead of making it unconditional', () => {
  const invalidWhens = [
    [],
    'tool=bash',
    { toool: 'bash' },
    { tool: '' },
    { tool: 'x'.repeat(500) },
    { retry: 'yes' },
    { pending: -1 },
    { pending: Number.POSITIVE_INFINITY },
    { phase: 'idle-ish' },
    { phase: ['nope'] },
    { hour: [24, 0] },
    { hour: [1] },
    { hour: [1.5, 2] },
  ]
  for (const when of invalidWhens) {
    assert.equal(normalizePhraseInput({ text: 'a', when }), undefined, 'reject when ' + JSON.stringify(when))
  }
  // Empty object means "always": kept as an unconditional entry.
  const empty = normalizePhraseInput({ text: 'a', when: {} })
  assert.equal(empty.text, 'a')
  assert.equal(empty.when, undefined)
})

test('normalizePhraseInput: control characters are rejected (incl. tab/newline)', () => {
  for (const bad of ['a\u0000b', 'a\u0007b', 'a\nb', 'a\tb', 'a\u007fb', 'a\u009bb']) {
    assert.equal(normalizePhraseInput(bad), undefined, 'reject ' + JSON.stringify(bad))
    assert.equal(normalizePhraseInput({ text: bad }), undefined)
  }
})

test('normalizePhraseInput: text length cap is counted in code points', () => {
  const ascii = 'a'.repeat(MAX_PHRASE_CODE_POINTS)
  assert.equal(normalizePhraseInput(ascii).text, ascii)
  assert.equal(normalizePhraseInput('a'.repeat(MAX_PHRASE_CODE_POINTS + 1)), undefined)
  const emoji = '😀'.repeat(MAX_PHRASE_CODE_POINTS)
  assert.equal(normalizePhraseInput(emoji).text, emoji)
  assert.equal(normalizePhraseInput('😀'.repeat(MAX_PHRASE_CODE_POINTS + 1)), undefined)
})

// ---------------------------------------------------------------------------
// normalizePhraseGroups
// ---------------------------------------------------------------------------

test('normalizePhraseGroups: object groups are normalized, missing groups empty', () => {
  const { groups, warnings } = normalizePhraseGroups({ thinking: ['a…', { text: 'b…', weight: 2 }], running: ['c…'] }, 'src')
  assert.deepEqual(warnings, [])
  assert.deepEqual(groups.thinking, [{ text: 'a…', weight: 1 }, { text: 'b…', weight: 2 }])
  assert.deepEqual(groups.running, [{ text: 'c…', weight: 1 }])
  assert.deepEqual(groups.long, [])
})

test('normalizePhraseGroups: legacy flat array is the thinking group', () => {
  const { groups } = normalizePhraseGroups(['a…', 'b…'], 'legacy')
  assert.deepEqual(groups.thinking.map((entry) => entry.text), ['a…', 'b…'])
  assert.deepEqual(groups.running, [])
  assert.deepEqual(groups.long, [])
})

test('normalizePhraseGroups: undefined is an empty group table without warnings', () => {
  const { groups, warnings } = normalizePhraseGroups(undefined, 'src')
  assert.deepEqual(warnings, [])
  assert.deepEqual(groups, { thinking: [], running: [], long: [] })
})

test('normalizePhraseGroups: invalid input and invalid groups warn without throwing', () => {
  for (const value of [null, 42, 'x', true]) {
    const { groups, warnings } = normalizePhraseGroups(value, 'src')
    assert.deepEqual(groups, { thinking: [], running: [], long: [] })
    assert.deepEqual(codes(warnings), ['bank.groups'])
  }
  const wrongGroup = normalizePhraseGroups({ thinking: ['ok…'], running: 'nope' }, 'src')
  assert.deepEqual(wrongGroup.groups.thinking.map((entry) => entry.text), ['ok…'])
  assert.deepEqual(codes(wrongGroup.warnings), ['bank.group'])
  const unknownKey = normalizePhraseGroups({ thinking: ['ok…'], idle: ['x…'] }, 'src')
  assert.deepEqual(codes(unknownKey.warnings), ['bank.unknown-field'])
})

test('normalizePhraseGroups: invalid entries are dropped with diagnostics paths', () => {
  const { groups, warnings } = normalizePhraseGroups(
    { thinking: ['good…', 42, { text: 'bad\u0007' }, { text: 'no when', when: { phase: 'bogus' } }] },
    'packs[2].phrases.zh.thinking',
  )
  assert.deepEqual(groups.thinking.map((entry) => entry.text), ['good…'])
  assert.deepEqual(codes(warnings), ['bank.entry', 'bank.text-control', 'bank.when-phase', 'bank.entry'])
  assert.ok(warnings.every((warning) => warning.message.startsWith('packs[2].phrases.zh.thinking')))
})

// ---------------------------------------------------------------------------
// mergePhaseEntries
// ---------------------------------------------------------------------------

test('mergePhaseEntries: appends normalized extras, de-duplicating by text, first weight wins', () => {
  const base = [{ text: 'a…', weight: 2 }]
  const merged = mergePhaseEntries(base, ['a…', 'b…', { text: 'c…', weight: 3 }, 'b…', 42], 'provider')
  assert.deepEqual(merged, [
    { text: 'a…', weight: 2 },
    { text: 'b…', weight: 1 },
    { text: 'c…', weight: 3 },
  ])
  assert.notEqual(merged, base, 'returns a new list')
})

// ---------------------------------------------------------------------------
// mergeBank
// ---------------------------------------------------------------------------

test('mergeBank: empty input yields a complete empty bank', () => {
  const bank = mergeBank({})
  assert.deepEqual(bank, {
    zh: { thinking: [], running: [], long: [] },
    en: { thinking: [], running: [], long: [] },
    includedPacks: [],
    warnings: [],
  })
})

test('mergeBank: core phrases are normalized and de-duplicated', () => {
  const bank = mergeBank({ core: { zh: { thinking: ['a…', 'b…', 'a…'], running: ['c…'] } } })
  assert.deepEqual(bank.zh.thinking.map((entry) => entry.text), ['a…', 'b…'])
  assert.deepEqual(bank.zh.running.map((entry) => entry.text), ['c…'])
  assert.deepEqual(bank.en, { thinking: [], running: [], long: [] })
  assert.deepEqual(bank.includedPacks, [])
})

test('mergeBank: enabledPacks semantics (undefined/null=all, []=core only, unknown ignored with warning)', () => {
  const packs = [
    { id: 'p1', phrases: { zh: { thinking: ['p1a…'] } } },
    { id: 'p2', phrases: { zh: { thinking: ['p2a…'] } } },
  ]
  const core = { zh: { thinking: ['core…'] } }
  const all = mergeBank({ core, packs })
  assert.deepEqual(all.zh.thinking.map((entry) => entry.text), ['core…', 'p1a…', 'p2a…'])
  assert.deepEqual(all.includedPacks, ['p1', 'p2'])
  assert.deepEqual(mergeBank({ core, packs, enabledPacks: null }).includedPacks, ['p1', 'p2'])
  const onlyOne = mergeBank({ core, packs, enabledPacks: ['p1'] })
  assert.deepEqual(onlyOne.zh.thinking.map((entry) => entry.text), ['core…', 'p1a…'])
  assert.deepEqual(onlyOne.includedPacks, ['p1'])
  const coreOnly = mergeBank({ core, packs, enabledPacks: [] })
  assert.deepEqual(coreOnly.zh.thinking.map((entry) => entry.text), ['core…'])
  assert.deepEqual(coreOnly.includedPacks, [])
  const unknown = mergeBank({ core, packs, enabledPacks: ['p1', 'ghost'] })
  assert.deepEqual(unknown.includedPacks, ['p1'])
  assert.deepEqual(codes(unknown.warnings), ['bank.unknown-pack'])
  assert.match(unknown.warnings[0].message, /ghost/)
})

test('mergeBank: packs merge in array order and keep the first occurrence weight', () => {
  const bank = mergeBank({
    packs: [
      { id: 'p1', phrases: { zh: { thinking: [{ text: 'same…', weight: 5 }] } } },
      { id: 'p2', phrases: { zh: { thinking: [{ text: 'same…', weight: 9 }, 'new…'] } } },
    ],
  })
  assert.deepEqual(bank.zh.thinking, [{ text: 'same…', weight: 5 }, { text: 'new…', weight: 1 }])
  assert.deepEqual(bank.includedPacks, ['p1', 'p2'])
})

test('mergeBank: packs that contribute nothing are not listed in includedPacks', () => {
  const bank = mergeBank({
    packs: [
      { id: 'p1', phrases: { zh: { thinking: ['same…'] } } },
      { id: 'p2', phrases: { zh: { thinking: ['same…'] } } },
      { id: 'p3', phrases: { zh: { thinking: [] } } },
      { id: 'p4' },
    ],
  })
  assert.deepEqual(bank.zh.thinking.map((entry) => entry.text), ['same…'])
  assert.deepEqual(bank.includedPacks, ['p1'])
})

test('mergeBank: dedupe is per language + phase (same text in other phase/language is kept)', () => {
  const bank = mergeBank({
    core: { zh: { thinking: ['same…'], running: ['same…'] }, en: { thinking: ['same…'] } },
  })
  assert.equal(bank.zh.thinking.length, 1)
  assert.equal(bank.zh.running.length, 1)
  assert.equal(bank.en.thinking.length, 1)
})

test('mergeBank: normalize warnings from packs are surfaced', () => {
  const bank = mergeBank({
    packs: [{ id: 'p1', phrases: { zh: { thinking: [{ text: 'x', weight: 5000 }, 'bad\u0000'] } } }],
  })
  assert.deepEqual(bank.zh.thinking, [{ text: 'x', weight: 1000 }])
  assert.deepEqual(codes(bank.warnings), ['bank.weight-clamped', 'bank.text-control'])
})

test('mergeBank: extraCore merges after packs, de-duplicating and normalizing', () => {
  const bank = mergeBank({
    core: { zh: { thinking: ['core…'] } },
    packs: [{ id: 'p1', phrases: { zh: { thinking: ['pack…'] } } }],
    extraCore: { zh: { thinking: ['pack…', { text: 'runtime…', weight: 4 }, 'bad\u0007'] }, en: {} },
  })
  assert.deepEqual(bank.zh.thinking, [
    { text: 'core…', weight: 1 },
    { text: 'pack…', weight: 1 },
    { text: 'runtime…', weight: 4 },
  ])
  assert.deepEqual(codes(bank.warnings), ['bank.text-control'])
})

test('mergeBank: malformed core/pack/extras degrade with warnings, never throw', () => {
  const bank = mergeBank({
    core: ['not', 'a table'],
    packs: [null, { id: 'p1', phrases: { zh: { thinking: ['ok…'] } } }, { nope: true }],
    extraCore: { zh: { thinking: 'not-an-array' }, en: { running: ['fine…'] } },
  })
  assert.deepEqual(bank.zh.thinking.map((entry) => entry.text), ['ok…'])
  assert.deepEqual(bank.en.running.map((entry) => entry.text), ['fine…'])
  assert.deepEqual(codes(bank.warnings), ['bank.core', 'bank.pack', 'bank.pack', 'bank.extra-core'])
})

// ---------------------------------------------------------------------------
// normalizePackInput
// ---------------------------------------------------------------------------

test('normalizePackInput: accepts id + label + phrase groups', () => {
  const { pack, warnings } = normalizePackInput({
    id: 'my-pack',
    label: { zh: '我的词库', en: 'My pack' },
    phrases: { zh: { running: ['正在替我干活…'] } },
  }, 'packs[0]')
  assert.deepEqual(warnings, [])
  assert.deepEqual(pack, {
    id: 'my-pack',
    label: { zh: '我的词库', en: 'My pack' },
    phrases: { zh: { thinking: [], running: [{ text: '正在替我干活…', weight: 1 }], long: [] } },
  })
})

test('normalizePackInput: unknown language keys warn but the pack stays usable', () => {
  const { pack, warnings } = normalizePackInput({ id: 'x', phrases: { zh: { thinking: ['ok…'] }, ja: { thinking: ['a…'] } } }, 'p')
  assert.equal(pack.id, 'x')
  assert.deepEqual(Object.keys(pack.phrases), ['zh'])
  assert.deepEqual(codes(warnings), ['bank.unknown-field'])
})

test('normalizePackInput: string label is shared by both languages', () => {
  const { pack } = normalizePackInput({ id: 'x', label: 'Shared', phrases: { en: { thinking: ['a…'] } } }, 'p')
  assert.deepEqual(pack.label, { zh: 'Shared', en: 'Shared' })
})

test('normalizePackInput: unusable packs are rejected with warnings', () => {
  const cases = [
    [null, ['bank.pack']],
    [{ id: '', phrases: {} }, ['bank.pack-id']],
    [{ id: 'x'.repeat(65), phrases: {} }, ['bank.pack-id']],
    [{ id: 'bad\u0000id', phrases: {} }, ['bank.pack-id']],
    [{ id: 'x' }, ['bank.pack-phrases']],
    [{ id: 'x', phrases: [] }, ['bank.pack-phrases']],
    [{ id: 'x', phrases: { zh: { thinking: [] } } }, ['bank.pack-empty']],
  ]
  for (const [input, expected] of cases) {
    const { pack, warnings } = normalizePackInput(input, 'p')
    assert.equal(pack, undefined, 'reject ' + JSON.stringify(input))
    assert.deepEqual(codes(warnings), expected, JSON.stringify(input))
  }
  // Unknown fields are ignored with a warning; the pack itself stays usable.
  const withExtra = normalizePackInput({ id: 'x', phrases: { zh: { thinking: ['ok…'] } }, extra: 1 }, 'p')
  assert.equal(withExtra.pack.id, 'x')
  assert.deepEqual(codes(withExtra.warnings), ['bank.unknown-field'])
})

// ---------------------------------------------------------------------------
// normalizeBankDoc (external bank file validation)
// ---------------------------------------------------------------------------

test('normalizeBankDoc: accepts only packs / phrases / enabledPacks, ignoring the rest', () => {
  const { doc, valid, warnings } = normalizeBankDoc({
    config: { intervalMs: 1000 },
    schedule: [],
    enabledPacks: ['p1'],
    packs: [{ id: 'p1', phrases: { zh: { thinking: ['a…'] } } }],
  }, 'bank.json')
  assert.equal(valid, true)
  assert.deepEqual(Object.keys(doc), ['packs', 'enabledPacks'])
  assert.equal(doc.enabledPacks[0], 'p1')
  assert.deepEqual(doc.packs[0].phrases.zh.thinking.map((entry) => entry.text), ['a…'])
  assert.deepEqual(codes(warnings), ['bank.unknown-field', 'bank.unknown-field'])
})

test('normalizeBankDoc: invalid documents are rejected explicitly', () => {
  for (const input of [null, 42, [], 'x']) {
    const result = normalizeBankDoc(input, 'bank.json')
    assert.equal(result.valid, false)
    assert.deepEqual(result.doc, {})
    assert.deepEqual(codes(result.warnings), ['bank.doc'])
  }
  const empty = normalizeBankDoc({ config: { intervalMs: 1 } }, 'bank.json')
  assert.equal(empty.valid, false)
  assert.deepEqual(codes(empty.warnings), ['bank.unknown-field', 'bank.doc-empty'])
})

test('normalizeBankDoc: legacy shared phrase table applies to both languages', () => {
  const { doc, valid } = normalizeBankDoc({ phrases: { thinking: ['a…'], running: ['b…'] } }, 'bank.json')
  assert.equal(valid, true)
  assert.deepEqual(doc.phrases.zh.thinking.map((entry) => entry.text), ['a…'])
  assert.deepEqual(doc.phrases.en.thinking.map((entry) => entry.text), ['a…'])
  assert.deepEqual(doc.phrases.en.running.map((entry) => entry.text), ['b…'])
})

test('normalizeBankDoc: language tables keep their languages separate', () => {
  const { doc } = normalizeBankDoc({ phrases: { en: { long: ['only english…'] } } }, 'bank.json')
  assert.equal(doc.phrases.zh, undefined)
  assert.deepEqual(doc.phrases.en.long.map((entry) => entry.text), ['only english…'])
})

test('normalizeBankDoc: invalid phrase entries are dropped with warnings', () => {
  const { doc, warnings } = normalizeBankDoc({ phrases: { zh: { thinking: ['ok…', 'bad\u0007', 42] } } }, 'bank.json')
  assert.deepEqual(doc.phrases.zh.thinking.map((entry) => entry.text), ['ok…'])
  assert.deepEqual(codes(warnings), ['bank.text-control', 'bank.entry'])
})

test('normalizeBankDoc: packs validation, dedupe and label normalization', () => {
  const { doc, warnings } = normalizeBankDoc({
    packs: [
      { id: 'p1', label: { zh: '一' }, phrases: { zh: { running: ['a…'] } } },
      { id: 'p1', phrases: { zh: { running: ['b…'] } } },
      { id: 'p2', phrases: {} },
      null,
    ],
  }, 'bank.json')
  assert.equal(doc.packs.length, 1)
  assert.deepEqual(doc.packs[0].label, { zh: '一' })
  assert.deepEqual(codes(warnings), ['bank.duplicate-pack', 'bank.pack-empty', 'bank.pack'])
})

test('normalizeBankDoc: enabledPacks accepts null and filters invalid ids with warnings', () => {
  assert.equal(normalizeBankDoc({ enabledPacks: null }, 'b').doc.enabledPacks, null)
  const filtered = normalizeBankDoc({ enabledPacks: ['p1', 42, '', null] }, 'b')
  assert.deepEqual(filtered.doc.enabledPacks, ['p1'])
  assert.deepEqual(codes(filtered.warnings), ['bank.enabled-packs', 'bank.enabled-packs', 'bank.enabled-packs'])
  const wrongType = normalizeBankDoc({ enabledPacks: 'p1' }, 'b')
  assert.equal(wrongType.valid, true)
  assert.equal(wrongType.doc.enabledPacks, undefined)
  assert.deepEqual(codes(wrongType.warnings), ['bank.enabled-packs'])
})

test('normalizeBankDoc: a document with a recognized key stays valid even when everything is dropped', () => {
  const { valid, doc, warnings } = normalizeBankDoc({ packs: [{ id: 'x' }] }, 'b')
  assert.equal(valid, true)
  assert.deepEqual(doc, { packs: [] })
  assert.deepEqual(codes(warnings), ['bank.pack-phrases'])
})