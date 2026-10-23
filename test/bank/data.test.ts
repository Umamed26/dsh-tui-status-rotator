/**
 * Corpus integrity for the ported phrase bank.
 *
 * These assertions are the contract between this package and the web original:
 * all 1362 entries from dsh-status-rotator's config.example.json must be
 * shipped verbatim (text, weight, order, zh/en split, pack labels/ids). The
 * whole corpus is pinned twice — a SHA-256 over its canonical JSON and a
 * per-pack/per-phase count table — so a silent reword, reorder or dropped
 * entry fails the suite without duplicating 95 KB of copy in the test.
 *
 * The suite imports the compiled output (lib/types) like every other test in
 * this package; run \`npm run build\` before \`node --test\`.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'

import {
  BUILTIN_BANK_DOC,
  BUILTIN_BANK_SHA256,
  BUILTIN_CORE_PHRASES,
  BUILTIN_PACKS,
  DEFAULT_ENABLED_PACKS,
} from '../../lib/types/bank/data.js'
import { mergeBank, normalizePhraseInput } from '../../lib/types/bank/normalize.js'

/** Pack ids in config.example.json order. */
const PACK_IDS = [
  'reverse-proxy', 'deepseek', 'western-ai', 'china-ai', 'coding', 'sysadmin',
  'math-physics', 'slacking', 'internet-memes', 'daily', 'community', 'ads',
  'star-ask', 'star-route',
]

/** Pack labels exactly as shipped by the web plugin. */
const PACK_LABELS = {
  'reverse-proxy': { zh: '反代', en: 'Reverse proxy' },
  'deepseek': { zh: 'DeepSeek 专场', en: 'DeepSeek' },
  'western-ai': { zh: '西方 AI 圈', en: 'Western AI' },
  'china-ai': { zh: '中国 AI 圈', en: 'Chinese AI' },
  'coding': { zh: '写代码日常', en: 'Coding' },
  'sysadmin': { zh: '系统管理', en: 'Sysadmin' },
  'math-physics': { zh: '数学与物理', en: 'Math & physics' },
  'slacking': { zh: '摸鱼', en: 'Slacking' },
  'internet-memes': { zh: '网络梗', en: 'Internet memes' },
  'daily': { zh: '日常', en: 'Daily life' },
  'community': { zh: '社区投稿', en: 'Community' },
  'ads': { zh: '广告', en: 'Ads' },
  'star-ask': { zh: '求 star', en: 'Star asks' },
  'star-route': { zh: '星标者路由', en: 'Stargazer routing' },
}

/**
 * Per-pack, per-language, per-phase entry counts, recomputed from
 * dsh-status-rotator config.example.json (README_ZH "词库现状" table).
 */
const PACK_COUNTS = {
  'reverse-proxy': { zh: 19, en: 21, phases: { 'zh.running': 14, 'zh.long': 5, 'en.thinking': 3, 'en.running': 13, 'en.long': 5 } },
  'deepseek': { zh: 107, en: 111, phases: { 'zh.thinking': 86, 'zh.running': 13, 'zh.long': 8, 'en.thinking': 81, 'en.running': 13, 'en.long': 17 } },
  'western-ai': { zh: 20, en: 22, phases: { 'zh.thinking': 13, 'zh.running': 3, 'zh.long': 4, 'en.thinking': 16, 'en.running': 2, 'en.long': 4 } },
  'china-ai': { zh: 22, en: 14, phases: { 'zh.thinking': 10, 'zh.running': 8, 'zh.long': 4, 'en.thinking': 6, 'en.running': 4, 'en.long': 4 } },
  'coding': { zh: 87, en: 81, phases: { 'zh.thinking': 49, 'zh.running': 33, 'zh.long': 5, 'en.thinking': 50, 'en.running': 26, 'en.long': 5 } },
  'sysadmin': { zh: 41, en: 38, phases: { 'zh.thinking': 17, 'zh.running': 21, 'zh.long': 3, 'en.thinking': 21, 'en.running': 12, 'en.long': 5 } },
  'math-physics': { zh: 35, en: 22, phases: { 'zh.thinking': 10, 'zh.running': 4, 'zh.long': 21, 'en.thinking': 4, 'en.running': 5, 'en.long': 13 } },
  'slacking': { zh: 40, en: 33, phases: { 'zh.thinking': 23, 'zh.running': 13, 'zh.long': 4, 'en.thinking': 20, 'en.running': 6, 'en.long': 7 } },
  'internet-memes': { zh: 57, en: 34, phases: { 'zh.thinking': 43, 'zh.running': 12, 'zh.long': 2, 'en.thinking': 29, 'en.running': 2, 'en.long': 3 } },
  'daily': { zh: 77, en: 64, phases: { 'zh.thinking': 43, 'zh.running': 8, 'zh.long': 26, 'en.thinking': 47, 'en.running': 4, 'en.long': 13 } },
  'community': { zh: 66, en: 0, phases: { 'zh.thinking': 20, 'zh.running': 24, 'zh.long': 22 } },
  'ads': { zh: 3, en: 3, phases: { 'zh.running': 3, 'en.running': 3 } },
  'star-ask': { zh: 11, en: 12, phases: { 'zh.thinking': 9, 'zh.running': 1, 'zh.long': 1, 'en.thinking': 10, 'en.running': 1, 'en.long': 1 } },
  'star-route': { zh: 161, en: 161, phases: { 'zh.thinking': 161, 'en.thinking': 161 } },
}

/** SHA-256 of config.example.json's {phrases,packs,enabledPacks}, first generated for this port. */
const EXPECTED_SHA256 = 'd6bbe22db130228eae4683b7bda6db10ebc3eb97369e6f6879eee6d97989ae25'

/** Count entries of one language across all packs. */
function countEntries(packs, lang) {
  let total = 0
  for (const pack of packs) {
    const groups = pack.phrases[lang]
    if (groups === undefined) continue
    for (const phase of Object.keys(groups)) total += groups[phase].length
  }
  return total
}

test('ships the 14 built-in packs in config.example.json order', () => {
  assert.equal(BUILTIN_PACKS.length, 14)
  assert.deepEqual(BUILTIN_PACKS.map((pack) => pack.id), PACK_IDS)
  assert.equal(new Set(PACK_IDS).size, 14, 'pack ids are unique')
})

test('pack labels match the web plugin', () => {
  for (const pack of BUILTIN_PACKS) {
    assert.deepEqual(pack.label, PACK_LABELS[pack.id], 'label of pack ' + pack.id)
  }
})

test('per-pack, per-language, per-phase counts match config.example.json', () => {
  for (const pack of BUILTIN_PACKS) {
    const expected = PACK_COUNTS[pack.id]
    assert.ok(expected, 'unexpected pack ' + pack.id)
    for (const lang of ['zh', 'en']) {
      const groups = pack.phrases[lang]
      const count = groups === undefined
        ? 0
        : ['thinking', 'running', 'long'].reduce((total, phase) => total + (Array.isArray(groups[phase]) ? groups[phase].length : 0), 0)
      assert.equal(count, expected[lang], pack.id + '.' + lang + ' entry count')
    }
    for (const [key, count] of Object.entries(expected.phases)) {
      const [lang, phase] = key.split('.')
      assert.equal(pack.phrases[lang][phase].length, count, pack.id + '.' + key + ' count')
    }
  }
})

test('corpus totals: 1362 entries split zh 746 / en 616', () => {
  assert.equal(countEntries(BUILTIN_PACKS, 'zh'), 746)
  assert.equal(countEntries(BUILTIN_PACKS, 'en'), 616)
  assert.equal(countEntries(BUILTIN_PACKS, 'zh') + countEntries(BUILTIN_PACKS, 'en'), 1362)
})

test('the 10 default-enabled packs carry 945 entries (zh 505 / en 440)', () => {
  assert.deepEqual(DEFAULT_ENABLED_PACKS, PACK_IDS.slice(0, 10))
  const enabled = new Set(DEFAULT_ENABLED_PACKS)
  const packs = BUILTIN_PACKS.filter((pack) => enabled.has(pack.id))
  assert.equal(packs.length, 10)
  assert.equal(countEntries(packs, 'zh'), 505)
  assert.equal(countEntries(packs, 'en'), 440)
  assert.equal(countEntries(packs, 'zh') + countEntries(packs, 'en'), 945)
  const disabled = BUILTIN_PACKS.filter((pack) => !enabled.has(pack.id)).map((pack) => pack.id)
  assert.deepEqual(disabled, ['community', 'ads', 'star-ask', 'star-route'])
})

test('canonical corpus SHA-256 matches the extracted config.example.json', () => {
  const canonical = JSON.stringify({
    phrases: BUILTIN_CORE_PHRASES,
    packs: BUILTIN_PACKS,
    enabledPacks: DEFAULT_ENABLED_PACKS,
  })
  const digest = createHash('sha256').update(canonical, 'utf8').digest('hex')
  assert.equal(digest, EXPECTED_SHA256, 'corpus copy/order/weight drifted from config.example.json')
  assert.equal(BUILTIN_BANK_SHA256, EXPECTED_SHA256, 'pinned export agrees with the test constant')
  assert.equal(BUILTIN_BANK_DOC.phrases, BUILTIN_CORE_PHRASES)
  assert.equal(BUILTIN_BANK_DOC.packs, BUILTIN_PACKS)
  assert.equal(BUILTIN_BANK_DOC.enabledPacks, DEFAULT_ENABLED_PACKS)
})

test('core phrases table is empty, exactly like the original', () => {
  assert.deepEqual(BUILTIN_CORE_PHRASES, {})
  assert.deepEqual(Object.keys(BUILTIN_CORE_PHRASES), [])
})

test('every entry is renderable and within the hardened limits', () => {
  let entries = 0
  for (const pack of BUILTIN_PACKS) {
    for (const lang of Object.keys(pack.phrases)) {
      for (const phase of Object.keys(pack.phrases[lang])) {
        for (const raw of pack.phrases[lang][phase]) {
          entries += 1
          const entry = normalizePhraseInput(raw)
          assert.ok(entry, 'entry must normalize: ' + pack.id + '.' + lang + '.' + phase)
          assert.equal(typeof entry.text, 'string')
          assert.ok(entry.text.length > 0)
          assert.ok(entry.text.trim().length > 0, 'no blank phrases')
          assert.ok(!/[\u0000-\u001f\u007f-\u009f]/.test(entry.text), 'no control characters: ' + JSON.stringify(entry.text))
          assert.ok([...entry.text].length <= 200, 'at most 200 code points')
          assert.equal(typeof entry.weight, 'number')
          assert.ok(entry.weight > 0 && entry.weight <= 1000)
          assert.equal(entry.when, undefined, 'built-in corpus carries no when conditions')
          assert.equal(entry.rarity, undefined, 'built-in corpus carries no rarity')
        }
      }
    }
  }
  assert.equal(entries, 1362)
})

test('the five weighted demo entries keep their exact copy and weight', () => {
  const weighted = []
  for (const pack of BUILTIN_PACKS) {
    for (const lang of Object.keys(pack.phrases)) {
      for (const phase of Object.keys(pack.phrases[lang])) {
        pack.phrases[lang][phase].forEach((raw, index) => {
          if (typeof raw !== 'string') weighted.push({ pack: pack.id, lang, phase, index, ...raw })
        })
      }
    }
  }
  assert.deepEqual(weighted, [
    { pack: 'coding', lang: 'en', phase: 'thinking', index: 6, text: "Calling a function that doesn't exist…", weight: 3 },
    { pack: 'slacking', lang: 'zh', phase: 'thinking', index: 21, text: '正在用 {tps} tok/s 的速度认真摸鱼…', weight: 2 },
    { pack: 'slacking', lang: 'en', phase: 'thinking', index: 19, text: 'Slacking off in earnest at {tps} tok/s…', weight: 2 },
    { pack: 'daily', lang: 'zh', phase: 'thinking', index: 36, text: '正在找个舒服的姿势…', weight: 3 },
    { pack: 'daily', lang: 'en', phase: 'thinking', index: 44, text: 'Getting into a comfortable position…', weight: 3 },
  ])
})

test('no duplicate text within one language + phase of a single pack', () => {
  for (const pack of BUILTIN_PACKS) {
    for (const lang of Object.keys(pack.phrases)) {
      for (const phase of Object.keys(pack.phrases[lang])) {
        const texts = pack.phrases[lang][phase].map((raw) => (typeof raw === 'string' ? raw : raw.text))
        assert.equal(new Set(texts).size, texts.length, 'duplicate entry in ' + pack.id + '.' + lang + '.' + phase)
      }
    }
  }
})

test('built-in data is deep-frozen (nothing may mutate the shipped copy)', () => {
  assert.ok(Object.isFrozen(BUILTIN_PACKS))
  assert.ok(Object.isFrozen(DEFAULT_ENABLED_PACKS))
  assert.ok(Object.isFrozen(BUILTIN_CORE_PHRASES))
  for (const pack of BUILTIN_PACKS) {
    assert.ok(Object.isFrozen(pack), 'pack header frozen: ' + pack.id)
    assert.ok(Object.isFrozen(pack.phrases), 'pack phrases frozen: ' + pack.id)
    if (pack.label !== undefined) assert.ok(Object.isFrozen(pack.label))
    for (const lang of Object.keys(pack.phrases)) {
      for (const phase of Object.keys(pack.phrases[lang])) {
        assert.ok(Object.isFrozen(pack.phrases[lang][phase]), 'entry list frozen: ' + pack.id + '.' + lang + '.' + phase)
      }
    }
  }
})

test('mergeBank over the built-in packs reproduces the corpus without dedupe loss', () => {
  const all = mergeBank({ packs: BUILTIN_PACKS, enabledPacks: null })
  assert.deepEqual(all.includedPacks, PACK_IDS)
  assert.equal(all.warnings.length, 0, 'trusted built-in data must not warn: ' + JSON.stringify(all.warnings))
  const total = (bank) => ['zh', 'en'].reduce((sum, lang) => sum + ['thinking', 'running', 'long'].reduce((phaseSum, phase) => phaseSum + bank[lang][phase].length, 0), 0)
  assert.equal(total(all), 1362)

  const shipped = mergeBank({ packs: BUILTIN_PACKS, enabledPacks: DEFAULT_ENABLED_PACKS })
  assert.deepEqual(shipped.includedPacks, DEFAULT_ENABLED_PACKS)
  assert.equal(shipped.warnings.length, 0)
  assert.equal(total(shipped), 945)

  const coreOnly = mergeBank({ packs: BUILTIN_PACKS, enabledPacks: [] })
  assert.deepEqual(coreOnly.includedPacks, [])
  assert.equal(total(coreOnly), 0)
})
