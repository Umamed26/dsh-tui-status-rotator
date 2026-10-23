/**
 * Engine tests for placeholders: built-in formatting, zh/en elapsed styles,
 * LiveContext.vars precedence, unknown reporting and the reserved-name contract.
 * Imports the BUILT output (lib/types/engine/placeholders.js).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createPlaceholderResolver,
  formatElapsed,
  BUILTIN_PLACEHOLDER_NAMES,
  PLACEHOLDER_NAME_PATTERN,
  isBuiltinPlaceholder,
} from '../../lib/types/engine/placeholders.js'
import type { LiveContext } from '../../lib/types/types.js'

/** Live facts with deterministic defaults. */
function live(overrides: Partial<LiveContext> = {}): LiveContext {
  return {
    lang: 'zh',
    phase: 'running',
    now: new Date(2026, 7, 7, 12, 34, 56).getTime(), // local 2026-08-07 12:34:56
    hour: 12,
    elapsedMs: 62_000,
    running: true,
    tool: [],
    retry: 0,
    pending: 0,
    firstTurn: false,
    ...overrides,
  }
}

const pad = (value: number): string => String(value).padStart(2, '0')

test('formatElapsed zh: seconds, minutes, hours', () => {
  assert.equal(formatElapsed(0, 'zh'), '0秒')
  assert.equal(formatElapsed(999, 'zh'), '0秒')
  assert.equal(formatElapsed(1000, 'zh'), '1秒')
  assert.equal(formatElapsed(62_000, 'zh'), '1分02秒')
  assert.equal(formatElapsed(600_000, 'zh'), '10分00秒')
  assert.equal(formatElapsed(3_600_000, 'zh'), '1小时0分00秒')
  assert.equal(formatElapsed(3_661_000, 'zh'), '1小时1分01秒')
  assert.equal(formatElapsed(-500, 'zh'), '0秒')
  assert.equal(formatElapsed(Number.NaN, 'zh'), '0秒')
})

test('formatElapsed en: seconds, minutes, hours', () => {
  assert.equal(formatElapsed(0, 'en'), '0s')
  assert.equal(formatElapsed(1000, 'en'), '1s')
  assert.equal(formatElapsed(62_000, 'en'), '1m 02s')
  assert.equal(formatElapsed(3_600_000, 'en'), '1h 0m 0s')
  assert.equal(formatElapsed(3_661_000, 'en'), '1h 1m 1s')
})

test('resolver replaces every built-in placeholder (zh)', () => {
  const resolver = createPlaceholderResolver()
  const text = [
    '{elapsed}', '{phase}', '{phaseLabel}', '{model}', '{provider}', '{tps}',
    '{pending}', '{tools}', '{running}', '{retry}', '{retryMax}', '{locale}',
    '{date}', '{time}', '{detail}',
  ].join('|')
  const result = resolver.resolve(text, live({
    model: 'deepseek-chat',
    provider: 'deepseek',
    tps: 12.6,
    pending: 2,
    tool: ['bash', 'read'],
    retry: 3,
    retryMax: 5,
  }))
  assert.equal(result.unknown.length, 0)
  assert.equal(result.text, [
    '1分02秒', 'running', '运行中', 'deepseek-chat', 'deepseek', '13',
    '2', 'bash+read', 'run', '3', '5', 'zh',
    '2026-08-07', '12:34:56', '⟳ 3/5',
  ].join('|'))
})

test('resolver uses en labels and en elapsed style', () => {
  const resolver = createPlaceholderResolver()
  const result = resolver.resolve('{elapsed} {phaseLabel} {locale} {running}', live({
    lang: 'en',
    phase: 'thinking',
    elapsedMs: 62_000,
    running: false,
  }))
  assert.equal(result.text, '1m 02s thinking en idle')
})

test('phaseLabel covers all three phases in both languages', () => {
  const resolver = createPlaceholderResolver()
  const labelsZh = ['thinking', 'running', 'long'].map(phase =>
    resolver.resolve('{phaseLabel}', live({ phase: phase as LiveContext['phase'] })).text)
  assert.deepEqual(labelsZh, ['思考中', '运行中', '长任务中'])
  const labelsEn = ['thinking', 'running', 'long'].map(phase =>
    resolver.resolve('{phaseLabel}', live({ lang: 'en', phase: phase as LiveContext['phase'] })).text)
  assert.deepEqual(labelsEn, ['thinking', 'running', 'long-running'])
})

test('missing host facts use the original fallbacks', () => {
  const resolver = createPlaceholderResolver()
  const result = resolver.resolve(
    '{model}|{provider}|{tps}|{pending}|{tools}|{retry}|{retryMax}|{detail}',
    live({ pending: 0, tool: [], retry: 0 }),
  )
  assert.equal(result.text, '—|—|' + '' + '|0|—|||')
})

test('tps is rounded, pending floors, tools join with +', () => {
  const resolver = createPlaceholderResolver()
  assert.equal(resolver.resolve('{tps}', live({ tps: 0 })).text, '0')
  assert.equal(resolver.resolve('{tps}', live({ tps: 3.49 })).text, '3')
  assert.equal(resolver.resolve('{tps}', live({ tps: 3.5 })).text, '4')
  assert.equal(resolver.resolve('{pending}', live({ pending: 2.9 })).text, '2')
  assert.equal(resolver.resolve('{pending}', live({ pending: -1 })).text, '0')
  assert.equal(resolver.resolve('{tools}', live({ tool: ['bash', 'web_search'] })).text, 'bash+web_search')
})

test('detail badge appears only while retrying and trims a missing cap', () => {
  const resolver = createPlaceholderResolver()
  assert.equal(resolver.resolve('{detail}', live({ retry: 3, retryMax: 5 })).text, '⟳ 3/5')
  assert.equal(resolver.resolve('{detail}', live({ retry: 2 })).text, '⟳ 2')
  assert.equal(resolver.resolve('{detail}', live({ retry: 0, retryMax: 5 })).text, '')
  assert.equal(resolver.resolve('{retry}|{retryMax}', live({ retry: 2 })).text, '2|')
})

test('date/time are local and zero-padded from LiveContext.now', () => {
  const resolver = createPlaceholderResolver()
  const now = new Date(2026, 0, 2, 3, 4, 5).getTime()
  const expected = new Date(now)
  assert.equal(
    resolver.resolve('{date} {time}', live({ now })).text,
    expected.getFullYear() + '-' + pad(expected.getMonth() + 1) + '-' + pad(expected.getDate())
      + ' ' + pad(expected.getHours()) + ':' + pad(expected.getMinutes()) + ':' + pad(expected.getSeconds()),
  )
})

test('unknown placeholders stay verbatim and are reported once', () => {
  const resolver = createPlaceholderResolver()
  const result = resolver.resolve('{nope} {elapsed} {also_nope} {nope} {123} {not a placeholder}', live())
  // {123} / {not a placeholder} do not match the identifier grammar: left
  // verbatim, not reported (they can never be a registered placeholder).
  assert.equal(result.text, '{nope} 1分02秒 {also_nope} {nope} {123} {not a placeholder}')
  assert.deepEqual(result.unknown, ['nope', 'also_nope'])
})

test('LiveContext.vars fills names the built-ins do not own', () => {
  const resolver = createPlaceholderResolver()
  const result = resolver.resolve('{myState} {elapsed}', live({
    vars: { myState: '3 项', elapsed: 'SHADOWED' },
  }))
  assert.equal(result.text, '3 项 1分02秒')
  assert.equal(result.unknown.length, 0)
})

test('vars with non-string values are treated as unknown', () => {
  const resolver = createPlaceholderResolver()
  const result = resolver.resolve('{weird}', live({ vars: { weird: 42 as unknown as string } }))
  assert.equal(result.text, '{weird}')
  assert.deepEqual(result.unknown, ['weird'])
})

test('empty text and empty vars are handled', () => {
  const resolver = createPlaceholderResolver()
  assert.deepEqual(resolver.resolve('', live()), { text: '', unknown: [] })
  assert.deepEqual(resolver.resolve('plain phrase', live()), { text: 'plain phrase', unknown: [] })
})

test('built-in placeholder registry is the public reservation contract', () => {
  assert.equal(BUILTIN_PLACEHOLDER_NAMES.size, 15)
  for (const name of [
    'elapsed', 'phase', 'phaseLabel', 'model', 'provider', 'tps', 'pending', 'tools',
    'running', 'retry', 'retryMax', 'locale', 'date', 'time', 'detail',
  ]) {
    assert.ok(BUILTIN_PLACEHOLDER_NAMES.has(name), name + ' must be reserved')
    assert.equal(isBuiltinPlaceholder(name), true)
  }
  assert.equal(isBuiltinPlaceholder('myState'), false)
})

test('PLACEHOLDER_NAME_PATTERN matches the service registration grammar', () => {
  assert.equal(PLACEHOLDER_NAME_PATTERN.test('myState'), true)
  assert.equal(PLACEHOLDER_NAME_PATTERN.test('my-state_2'), true)
  assert.equal(PLACEHOLDER_NAME_PATTERN.test('1abc'), false)
  assert.equal(PLACEHOLDER_NAME_PATTERN.test('has space'), false)
  assert.equal(PLACEHOLDER_NAME_PATTERN.test('a'.repeat(33)), false)
})
