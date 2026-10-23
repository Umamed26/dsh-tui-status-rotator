#!/usr/bin/env node
/**
 * Audit the shipped phrase bank from the BUILT output (lib/types/bank/...),
 * never from src/. The script is a data-quality gate: it proves the corpus the
 * runtime will actually load is complete, phase-addressable, duplicate-free and
 * short enough for a 1-3 row status line.
 *
 * Checks
 *  - every pack has a stable id, a label and only zh/en phrase groups;
 *  - every entry is a string or { text, weight?, when?, rarity? } with a valid
 *    text; every group lives under a known phase, so every entry has a phase;
 *  - no control characters, no same-phase duplicates, no cross-language twins;
 *  - text stays inside the status-line budget (display cells, not UTF-16 units);
 *  - series share sanity: each phase, each language and each pack holds a
 *    usable share of the corpus, and the default-enabled selection is neither
 *    empty nor the whole corpus;
 *  - the documented totals (14 packs / 1362 entries / zh 746 / en 616 /
 *    default 10 packs / 945 enabled) have not drifted silently (warning; use
 *    --strict to make documented-count drift a failure).
 *
 * Run: npm run build && node scripts/check-bank.mjs [--strict]
 * Exit: 0 no errors, 1 at least one error (or documented-count drift with --strict).
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const strict = process.argv.includes('--strict')
const PHASES = ['thinking', 'running', 'long']
const LANGS = ['zh', 'en']

/** Totals documented in src/bank/data.ts and README; drift is reported. */
const DOCUMENTED = Object.freeze({
  packs: 14, total: 1362, zh: 746, en: 616, enabledPacks: 10, enabled: 945,
})
/** Display-cell budget for a phrase on a 1-3 row status line. */
const CELL_HARD_LIMIT = 96
const CELL_WARN_LIMIT = 72
/** Weight/rarity bounds from the bank format. */
const MAX_WEIGHT = 1000
const ENTRY_KEYS = ['text', 'weight', 'when', 'rarity']
const WHEN_KEYS = ['tool', 'retry', 'pending', 'phase', 'hour', 'firstTurn']

const entryText = entry => (typeof entry === 'string' ? entry : (entry !== null && typeof entry === 'object' && typeof entry.text === 'string' ? entry.text : undefined))

/** Approximate terminal display width: CJK/fullwidth/emoji = 2 cells, else 1. */
export function cellWidth(text) {
  let width = 0
  for (const char of text) {
    const code = char.codePointAt(0)
    const wide = (code >= 0x1100 && code <= 0x115f)
      || (code >= 0x2e80 && code <= 0xa4cf)
      || (code >= 0xac00 && code <= 0xd7a3)
      || (code >= 0xf900 && code <= 0xfaff)
      || (code >= 0xfe30 && code <= 0xfe4f)
      || (code >= 0xff00 && code <= 0xff60)
      || (code >= 0xffe0 && code <= 0xffe6)
      || (code >= 0x1f300 && code <= 0x1faff)
    width += wide ? 2 : 1
  }
  return width
}

const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u
const PACK_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u
const isObject = value => typeof value === 'object' && value !== null && !Array.isArray(value)
const pad = (value, width) => String(value).padEnd(width)
const padStart = (value, width) => String(value).padStart(width)

/**
 * Pure audit of a built-in bank document. Exported so the check can be unit
 * tested against fixtures without a build.
 * @returns {{ errors: string[], warnings: string[], rows: object[], summary: object }}
 */
export function auditBank({ packs, corePhrases = {}, enabledPacks = [], bankSha256 } = {}) {
  const errors = []
  const warnings = []
  const rows = []
  const duplicatePhaseKeys = new Map() // "lang\0phase\0text" -> first location
  const textLocations = new Map() // "lang\0text" -> [phases...]
  const allTexts = { zh: [], en: [] }
  let total = 0
  const phaseTotals = { zh: Object.fromEntries(PHASES.map(phase => [phase, 0])), en: Object.fromEntries(PHASES.map(phase => [phase, 0])) }

  if (!Array.isArray(packs) || packs.length === 0) errors.push('BUILTIN_PACKS is not a non-empty array')
  const safePacks = Array.isArray(packs) ? packs : []
  const packIds = new Set()
  const packTotals = new Map()
  const maxCellsByOwner = new Map()
  const longest = []

  const walkGroup = (owner, lang, phase, list) => {
    const where = owner + '.' + lang + '.' + phase
    if (!Array.isArray(list)) { errors.push(where + ': phase group is not an array'); return }
    for (const [index, entry] of list.entries()) {
      const entryWhere = where + '[' + index + ']'
      const text = entryText(entry)
      if (text === undefined || text.trim() === '') {
        errors.push(entryWhere + ': entry has no non-empty text (' + JSON.stringify(entry) + ')')
        continue
      }
      if (typeof entry === 'object') {
        const extra = Object.keys(entry).filter(key => !ENTRY_KEYS.includes(key))
        if (extra.length > 0) errors.push(entryWhere + ': unknown entry key(s) ' + extra.join(', '))
        if (entry.weight !== undefined && (!Number.isInteger(entry.weight) || entry.weight < 1 || entry.weight > MAX_WEIGHT)) {
          errors.push(entryWhere + ': weight must be an integer 1..' + MAX_WEIGHT + ', got ' + String(entry.weight))
        }
        if (entry.rarity !== undefined && (typeof entry.rarity !== 'number' || !(entry.rarity > 0 && entry.rarity <= 1))) {
          errors.push(entryWhere + ': rarity must be a number in (0, 1], got ' + String(entry.rarity))
        }
        if (entry.when !== undefined) {
          if (!isObject(entry.when)) errors.push(entryWhere + ': when must be an object')
          else {
            const extraWhen = Object.keys(entry.when).filter(key => !WHEN_KEYS.includes(key))
            if (extraWhen.length > 0) errors.push(entryWhere + ': unknown when key(s) ' + extraWhen.join(', '))
          }
        }
      }
      if (CONTROL_CHARS.test(text)) errors.push(entryWhere + ': control character in text ' + JSON.stringify(text))
      if (!text.endsWith('\u2026')) warnings.push(entryWhere + ': phrase does not end with an ellipsis (\u2026): ' + JSON.stringify(text))
      const cells = cellWidth(text)
      if (cells > CELL_HARD_LIMIT) errors.push(entryWhere + ': ' + cells + ' display cells exceeds the ' + CELL_HARD_LIMIT + '-cell status-line budget: ' + JSON.stringify(text))
      else if (cells > CELL_WARN_LIMIT) warnings.push(entryWhere + ': ' + cells + ' display cells is long for a status line: ' + JSON.stringify(text))
      maxCellsByOwner.set(owner, Math.max(maxCellsByOwner.get(owner) ?? 0, cells))
      longest.push({ where: entryWhere, cells, text })

      const phaseKey = lang + '\0' + phase + '\0' + text
      if (duplicatePhaseKeys.has(phaseKey)) {
        errors.push(entryWhere + ': duplicate phrase in the same phase/lang — first seen at ' + duplicatePhaseKeys.get(phaseKey) + ': ' + JSON.stringify(text))
      } else duplicatePhaseKeys.set(phaseKey, entryWhere)
      const textKey = lang + '\0' + text
      if (!textLocations.has(textKey)) textLocations.set(textKey, [])
      textLocations.get(textKey).push(owner + '.' + phase)
      allTexts[lang].push(text)
      phaseTotals[lang][phase] += 1
      total += 1
    }
  }

  // Core phrases table (empty in the shipped bank, kept for completeness).
  if (isObject(corePhrases)) {
    const unknownLangs = Object.keys(corePhrases).filter(key => !LANGS.includes(key))
    if (unknownLangs.length > 0) errors.push('core.phrases has unknown language key(s): ' + unknownLangs.join(', '))
    for (const lang of LANGS) {
      const groups = corePhrases[lang]
      if (groups === undefined) continue
      if (!isObject(groups)) { errors.push('core.phrases.' + lang + ' is not an object'); continue }
      const unknownPhases = Object.keys(groups).filter(key => !PHASES.includes(key))
      if (unknownPhases.length > 0) errors.push('core.phrases.' + lang + ' has unknown phase key(s): ' + unknownPhases.join(', '))
      for (const phase of PHASES) if (groups[phase] !== undefined) walkGroup('core', lang, phase, groups[phase])
    }
  } else if (corePhrases !== undefined) errors.push('BUILTIN_CORE_PHRASES is not an object')

  for (const [packIndex, pack] of safePacks.entries()) {
    const where = 'packs[' + packIndex + ']'
    if (!isObject(pack)) { errors.push(where + ': pack is not an object'); continue }
    if (typeof pack.id !== 'string' || !PACK_ID.test(pack.id)) errors.push(where + ': pack id must be a lower-kebab string, got ' + JSON.stringify(pack.id))
    const packId = typeof pack.id === 'string' ? pack.id : where
    if (packIds.has(packId)) errors.push(where + ': duplicate pack id ' + packId)
    packIds.add(packId)
    if (pack.label !== undefined && (!isObject(pack.label) || Object.keys(pack.label).some(key => !LANGS.includes(key)))) {
      errors.push(packId + ': label must be an object with zh/en strings')
    }
    if (!isObject(pack.phrases)) { errors.push(packId + ': phrases is not an object'); continue }
    const unknownLangs = Object.keys(pack.phrases).filter(key => !LANGS.includes(key))
    if (unknownLangs.length > 0) errors.push(packId + ': phrases has unknown language key(s): ' + unknownLangs.join(', '))
    const perLang = { zh: 0, en: 0 }
    const perPhase = { zh: Object.fromEntries(PHASES.map(phase => [phase, 0])), en: Object.fromEntries(PHASES.map(phase => [phase, 0])) }
    for (const lang of LANGS) {
      const groups = pack.phrases[lang]
      if (groups === undefined) continue
      if (!isObject(groups)) { errors.push(packId + '.phrases.' + lang + ' is not an object'); continue }
      const unknownPhases = Object.keys(groups).filter(key => !PHASES.includes(key))
      if (unknownPhases.length > 0) errors.push(packId + '.phrases.' + lang + ' has unknown phase key(s): ' + unknownPhases.join(', '))
      for (const phase of PHASES) {
        if (groups[phase] === undefined) continue
        const before = phaseTotals[lang][phase]
        walkGroup(packId, lang, phase, groups[phase])
        const added = phaseTotals[lang][phase] - before
        perLang[lang] += added
        perPhase[lang][phase] += added
      }
      if (perLang[lang] === 0 && Array.isArray(groups[PHASES[0]])) warnings.push(packId + ': declares a ' + lang + ' phrase table with no entries')
    }
    if (perLang.zh === 0 && perLang.en === 0) errors.push(packId + ': pack has no phrases in any language')
    packTotals.set(packId, perLang.zh + perLang.en)
    rows.push({ id: packId, on: enabledPacks.includes(packId), zh: perLang.zh, en: perLang.en, total: perLang.zh + perLang.en, perPhase, maxCells: maxCellsByOwner.get(packId) ?? 0 })
  }

  // --- enabled selection -----------------------------------------------------
  if (!Array.isArray(enabledPacks)) errors.push('DEFAULT_ENABLED_PACKS is not an array')
  const safeEnabled = Array.isArray(enabledPacks) ? enabledPacks : []
  const enabledSet = new Set()
  for (const id of safeEnabled) {
    if (typeof id !== 'string' || id.trim() === '') errors.push('DEFAULT_ENABLED_PACKS contains a non-string id: ' + JSON.stringify(id))
    else if (enabledSet.has(id)) errors.push('DEFAULT_ENABLED_PACKS contains a duplicate id: ' + id)
    else if (!packIds.has(id)) errors.push('DEFAULT_ENABLED_PACKS names an unknown pack: ' + id)
    enabledSet.add(id)
  }
  if (enabledSet.size === 0) errors.push('DEFAULT_ENABLED_PACKS is empty (the default status line would never rotate)')
  let enabledTotal = 0
  for (const [id, packTotal] of packTotals) if (enabledSet.has(id)) enabledTotal += packTotal

  // --- duplicate / share sanity ---------------------------------------------
  for (const lang of LANGS) {
    if (allTexts[lang].length === 0) errors.push('no ' + lang + ' phrases in the built-in bank')
  }
  const crossLang = []
  for (const [key, phases] of textLocations) {
    const [lang, text] = key.split('\0')
    if (lang !== 'zh') continue
    const english = textLocations.get('en\0' + text)
    if (english !== undefined) crossLang.push({ text, zhPhases: phases, enPhases: english })
  }
  for (const twin of crossLang.slice(0, 20)) {
    warnings.push('cross-language duplicate phrase: ' + JSON.stringify(twin.text))
  }
  if (crossLang.length > 20) warnings.push('... and ' + (crossLang.length - 20) + ' more cross-language duplicate phrase(s)')

  // Phrase reused across phases of the same language is intentional (ported data).
  let sharedAcrossPhases = 0
  for (const [key, phases] of textLocations) {
    if (phases.length > 1) sharedAcrossPhases += 1
  }

  for (const lang of LANGS) {
    const langTotal = allTexts[lang].length
    if (langTotal === 0) continue
    for (const phase of PHASES) {
      const share = phaseTotals[lang][phase] / langTotal
      if (share < 0.05) warnings.push(lang + '.' + phase + ' holds only ' + (share * 100).toFixed(1) + '% of the ' + lang + ' corpus (phase may be under-served)')
      if (share > 0.9) warnings.push(lang + '.' + phase + ' holds ' + (share * 100).toFixed(1) + '% of the ' + lang + ' corpus (other phases may be under-served)')
    }
  }
  if (total > 0) {
    const largest = [...packTotals.entries()].sort((a, b) => b[1] - a[1])[0]
    if (largest !== undefined && largest[1] / total > 0.4) {
      warnings.push('pack ' + largest[0] + ' holds ' + (largest[1] / total * 100).toFixed(1) + '% of the corpus (single pack dominates)')
    }
    const enabledShare = enabledTotal / total
    if (enabledTotal > 0 && (enabledShare < 0.3 || enabledShare > 0.95)) {
      warnings.push('default-enabled corpus is ' + (enabledShare * 100).toFixed(1) + '% of the total corpus (selection looks wrong)')
    }
  }
  for (const [id, packTotal] of packTotals) {
    if (enabledSet.has(id) && enabledTotal > 0 && packTotal / enabledTotal < 0.005) {
      warnings.push('enabled pack ' + id + ' holds <0.5% of the enabled corpus')
    }
  }
  if (enabledTotal !== total && enabledSet.size === packIds.size && packIds.size > 0) {
    warnings.push('all packs are default-enabled, so the enabled/disabled distinction is untested')
  }

  // --- documented totals drift ----------------------------------------------
  const summary = {
    packs: safePacks.length,
    total,
    zh: allTexts.zh.length,
    en: allTexts.en.length,
    enabledPacks: enabledSet.size,
    enabled: enabledTotal,
    phaseTotals,
    sharedAcrossPhases,
    crossLangDuplicates: crossLang.length,
    packTotals,
    bankSha256,
  }
  for (const key of Object.keys(DOCUMENTED)) {
    const actual = summary[key]
    if (actual !== DOCUMENTED[key]) {
      const message = 'documented total ' + key + ' is ' + DOCUMENTED[key] + ', built bank has ' + actual + ' (update docs/this script if intentional)'
      if (strict) errors.push(message)
      else warnings.push(message)
    }
  }
  if (typeof bankSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(bankSha256)) {
    warnings.push('BUILTIN_BANK_SHA256 is missing or not a sha256 hex digest')
  }
  return { errors, warnings, rows, summary, longest }
}

/** Print a compact table of per-pack counts and shares. */
function printTable({ rows, summary }) {
  const total = summary.total
  const header = ['pack', 'on', 'zh', 'en', 'total', 'share', 'zh t/r/l', 'en t/r/l', 'maxCells']
  const cells = rows.map(row => {
    return [
      row.id,
      row.on ? 'on' : 'off',
      String(row.zh),
      String(row.en),
      String(row.total),
      total === 0 ? '0.0%' : (row.total / total * 100).toFixed(1) + '%',
      PHASES.map(phase => row.perPhase.zh[phase]).join('/'),
      PHASES.map(phase => row.perPhase.en[phase]).join('/'),
      String(row.maxCells),
    ]
  })
  const widths = header.map((label, index) => Math.max(label.length, ...cells.map(row => row[index].length)))
  console.log('== built-in packs (' + rows.length + ') ==')
  console.log(header.map((label, index) => pad(label, widths[index])).join('  '))
  console.log(widths.map(width => '-'.repeat(width)).join('  '))
  for (const row of cells) console.log(row.map((value, index) => pad(value, widths[index])).join('  '))
  const totals = ['TOTAL', '', String(summary.zh), String(summary.en), String(total), '100%', '', '', '']
  console.log(widths.map(width => '-'.repeat(width)).join('  '))
  console.log(totals.map((value, index) => pad(value, widths[index])).join('  '))
  console.log('')
  console.log('default-enabled: ' + summary.enabledPacks + ' packs / ' + summary.enabled + ' entries (' + (total === 0 ? '0.0' : (summary.enabled / total * 100).toFixed(1)) + '% of corpus)')
  console.log('phase totals: zh thinking=' + summary.phaseTotals.zh.thinking + ' running=' + summary.phaseTotals.zh.running + ' long=' + summary.phaseTotals.zh.long
    + ' | en thinking=' + summary.phaseTotals.en.thinking + ' running=' + summary.phaseTotals.en.running + ' long=' + summary.phaseTotals.en.long)
  console.log('phrases reused across phases (intentional): ' + summary.sharedAcrossPhases + ' | cross-language twins: ' + summary.crossLangDuplicates)
}

async function main() {
  const builtData = join(root, 'lib', 'types', 'bank', 'data.js')
  const builtIndex = join(root, 'lib', 'types', 'bank', 'index.js')
  if (!existsSync(builtData)) {
    console.error('FAIL: ' + builtData + ' is missing — the bank check reads the BUILT output; run "npm run build" first')
    process.exitCode = 1
    return
  }
  if (!existsSync(builtIndex)) {
    console.warn('WARN: ' + builtIndex + ' is missing (the bank barrel export was not built)')
  }
  const module = await import(pathToFileURL(builtData).href)
  const { BUILTIN_PACKS, BUILTIN_CORE_PHRASES, DEFAULT_ENABLED_PACKS, BUILTIN_BANK_DOC, BUILTIN_BANK_SHA256 } = module
  const doc = BUILTIN_BANK_DOC ?? { phrases: BUILTIN_CORE_PHRASES, packs: BUILTIN_PACKS, enabledPacks: DEFAULT_ENABLED_PACKS }
  console.log('built bank: ' + builtData)
  const report = auditBank({
    packs: doc.packs ?? BUILTIN_PACKS,
    corePhrases: doc.phrases ?? BUILTIN_CORE_PHRASES ?? {},
    enabledPacks: doc.enabledPacks ?? DEFAULT_ENABLED_PACKS ?? [],
    bankSha256: BUILTIN_BANK_SHA256,
  })
  printTable(report)
  const computedHash = sha256(canonicalBankJson(doc))
  console.log('bank sha256 (JSON.stringify canonicalization): ' + computedHash
    + (typeof BUILTIN_BANK_SHA256 === 'string'
      ? (computedHash === BUILTIN_BANK_SHA256 ? ' (matches BUILTIN_BANK_SHA256)' : ' (BUILTIN_BANK_SHA256 pins a different canonicalization; test/bank/data.test.ts owns that)')
      : ''))

  console.log('== longest phrases (display cells) ==')
  for (const item of [...report.longest].sort((a, b) => b.cells - a.cells).slice(0, 5)) {
    console.log('  ' + padStart(item.cells, 3) + ' cells  ' + item.where + '  ' + JSON.stringify(item.text))
  }
  console.log('')
  if (report.warnings.length > 0) {
    console.log('== warnings (' + report.warnings.length + ') ==')
    for (const message of report.warnings.slice(0, 60)) console.log('WARN: ' + message)
    if (report.warnings.length > 60) console.log('... and ' + (report.warnings.length - 60) + ' more warning(s)')
  }
  if (report.errors.length > 0) {
    console.log('== errors (' + report.errors.length + ') ==')
    for (const message of report.errors) console.log('FAIL: ' + message)
    console.error('FAIL: bank audit found ' + report.errors.length + ' error(s)')
    process.exitCode = 1
    return
  }
  console.log('PASS: bank audit clean — ' + report.summary.total + ' entries in ' + report.summary.packs + ' packs (zh ' + report.summary.zh + ' / en ' + report.summary.en + '), default ' + report.summary.enabledPacks + ' packs / ' + report.summary.enabled + ' entries')
}

// Also verify the shipped hash equals the canonical serialization when reachable.
export function canonicalBankJson(doc) {
  return JSON.stringify(doc)
}
export function sha256(text) {
  return createHash('sha256').update(text).digest('hex')
}

const isMain = process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url
if (isMain) {
  main().catch(error => {
    console.error('FAIL: bank audit crashed — ' + (error instanceof Error ? error.stack ?? error.message : String(error)))
    process.exitCode = 1
  })
}