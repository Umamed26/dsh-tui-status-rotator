/**
 * Engine tests for render helpers: grapheme segmentation, typewriter reveal,
 * per-cell gradient sweep and gradient spec resolution.
 * Imports the BUILT output (lib/types/engine/render.js).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  textGraphemes,
  revealCount,
  gradientColors,
  resolveGradientSpec,
} from '../../lib/types/engine/render.js'
import { DEFAULT_RESOLVED_CONFIG, THEME_GRADIENT_PALETTE, DEFAULT_GRADIENT_COLORS, DEFAULT_GRADIENT_DAY_COLORS } from '../../lib/types/config.js'
import type { GradientSpec, ResolvedConfig } from '../../lib/types/types.js'

/** A resolved config with overrides. */
function config(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return { ...DEFAULT_RESOLVED_CONFIG, ...overrides }
}

/** A gradient spec with overrides. */
function spec(overrides: Partial<GradientSpec> = {}): GradientSpec {
  return {
    mode: 'day',
    direction: 'rtl',
    palette: ['A', 'B', 'C'],
    speedMs: 3000,
    ...overrides,
  }
}

test('textGraphemes splits user-perceived characters, not code units', () => {
  assert.deepEqual(textGraphemes('abc'), ['a', 'b', 'c'])
  assert.deepEqual(textGraphemes('你好'), ['你', '好'])
  assert.deepEqual(textGraphemes('👍🏽'), ['👍🏽'])
  assert.deepEqual(textGraphemes('👨‍👩‍👧'), ['👨‍👩‍👧'])
  assert.deepEqual(textGraphemes('e\u0301'), ['e\u0301'])
  assert.deepEqual(textGraphemes(''), [])
})

test('revealCount reveals the first grapheme immediately, then one per tick', () => {
  const startedAt = 1000
  assert.equal(revealCount('abcd', startedAt, 30, startedAt), 1)
  assert.equal(revealCount('abcd', startedAt, 30, startedAt + 29), 1)
  assert.equal(revealCount('abcd', startedAt, 30, startedAt + 30), 2)
  assert.equal(revealCount('abcd', startedAt, 30, startedAt + 59), 2)
  assert.equal(revealCount('abcd', startedAt, 30, startedAt + 60), 3)
  assert.equal(revealCount('abcd', startedAt, 30, startedAt + 600), 4)
  assert.equal(revealCount('abcd', startedAt, 30, startedAt - 500), 1)
})

test('revealCount with speed 0 (or invalid) reveals everything at once', () => {
  assert.equal(revealCount('abcd', 0, 0, 0), 4)
  assert.equal(revealCount('abcd', 0, -10, 0), 4)
  assert.equal(revealCount('abcd', 0, Number.NaN, 0), 4)
  assert.equal(revealCount('', 0, 30, 1000), 0)
  assert.equal(revealCount('你好世界', 0, 30, 10_000), 4)
})

test('gradientColors returns one color per grapheme', () => {
  assert.deepEqual(gradientColors(spec(), 4, 0, 0), ['A', 'B', 'C', 'A'])
  assert.deepEqual(gradientColors(spec(), 0, 0, 0), [])
  assert.deepEqual(gradientColors(spec({ palette: [] }), 4, 0, 0), [])
  assert.equal(gradientColors(spec(), 7, 0, 0).length, 7)
  assert.equal(gradientColors(spec(), 4.9, 0, 0).length, 4)
})

test('rtl and ltr flow in opposite directions', () => {
  const startedAt = 10_000
  // One third of the 3s period: exactly one palette step.
  const at = startedAt + 1000
  assert.deepEqual(gradientColors(spec({ direction: 'rtl' }), 4, at, startedAt), ['B', 'C', 'A', 'B'])
  assert.deepEqual(gradientColors(spec({ direction: 'ltr' }), 4, at, startedAt), ['C', 'A', 'B', 'C'])
})

test('one full palette cycle per speedMs (seamless loop)', () => {
  const startedAt = 0
  const base = gradientColors(spec(), 6, 0, startedAt)
  assert.deepEqual(gradientColors(spec(), 6, 3000, startedAt), base)
  assert.deepEqual(gradientColors(spec(), 6, 6000, startedAt), base)
  // Half a cycle with 3 colors: two steps.
  assert.deepEqual(gradientColors(spec(), 6, 2000, startedAt), ['C', 'A', 'B', 'C', 'A', 'B'])
})

test('pinned clock produces a stable per-cell array', () => {
  const pinned = spec({ direction: 'rtl' })
  const first = gradientColors(pinned, 12, 123_456, 120_000)
  const second = gradientColors(pinned, 12, 123_456, 120_000)
  assert.deepEqual(first, second)
  for (let index = 1; index < first.length; index++) {
    assert.notEqual(first[index], first[index - 1])
  }
})

test('speedMs 0 or invalid paints a static spatial pattern', () => {
  const staticSpec = spec({ speedMs: 0 })
  assert.deepEqual(gradientColors(staticSpec, 4, 0, 0), ['A', 'B', 'C', 'A'])
  assert.deepEqual(gradientColors(staticSpec, 4, 99_999, 0), ['A', 'B', 'C', 'A'])
})

test('gradientColors tolerates invalid timing and count inputs', () => {
  assert.deepEqual(gradientColors(spec(), 3, Number.NaN, Number.NaN), ['A', 'B', 'C'])
  assert.deepEqual(gradientColors(spec(), -2, 0, 0), [])
  assert.deepEqual(gradientColors(spec(), Number.NaN, 0, 0), [])
})

test('resolveGradientSpec: disabled gradients yield undefined', () => {
  assert.equal(resolveGradientSpec(config({ gradientEnabled: false })), undefined)
  assert.equal(resolveGradientSpec(null as unknown as ResolvedConfig), undefined)
})

test('resolveGradientSpec: theme mode uses the host theme palette', () => {
  const resolved = resolveGradientSpec(config({ gradientEnabled: true, gradientMode: 'theme' }))
  assert.ok(resolved !== undefined)
  assert.equal(resolved.mode, 'theme')
  assert.deepEqual(resolved.palette, [...THEME_GRADIENT_PALETTE])
  assert.equal(resolved.direction, 'rtl')
  assert.equal(resolved.speedMs, 4000)
})

test('resolveGradientSpec: day and night modes use their configured palettes', () => {
  const day = resolveGradientSpec(config({ gradientMode: 'day', gradientSpeedSec: 7, gradientDirection: 'ltr' }))
  assert.ok(day !== undefined)
  assert.equal(day.mode, 'day')
  assert.deepEqual(day.palette, [...DEFAULT_GRADIENT_DAY_COLORS])
  assert.equal(day.direction, 'ltr')
  assert.equal(day.speedMs, 7000)

  const night = resolveGradientSpec(config({ gradientMode: 'night' }))
  assert.ok(night !== undefined)
  assert.equal(night.mode, 'night')
  assert.deepEqual(night.palette, [...DEFAULT_GRADIENT_COLORS])
})

test('resolveGradientSpec: speed is clamped to the 1..60s envelope', () => {
  assert.equal(resolveGradientSpec(config({ gradientSpeedSec: 0 }))?.speedMs, 1000)
  assert.equal(resolveGradientSpec(config({ gradientSpeedSec: 0.4 }))?.speedMs, 1000)
  assert.equal(resolveGradientSpec(config({ gradientSpeedSec: 120 }))?.speedMs, 60_000)
  assert.equal(resolveGradientSpec(config({ gradientSpeedSec: Number.NaN }))?.speedMs, 4000)
})

test('resolveGradientSpec: empty palettes disable the gradient instead of hiding text', () => {
  assert.equal(resolveGradientSpec(config({ gradientMode: 'night', gradientColors: [] })), undefined)
  assert.equal(resolveGradientSpec(config({ gradientMode: 'day', gradientDayColors: [] })), undefined)
})

test('gradientColors works with the resolved spec (end-to-end)', () => {
  const resolved = resolveGradientSpec(config({ gradientMode: 'day', gradientSpeedSec: 4 }))
  assert.ok(resolved !== undefined)
  const colors = gradientColors(resolved, 10, 2000, 0)
  assert.equal(colors.length, 10)
  assert.ok(colors.every(color => (DEFAULT_GRADIENT_DAY_COLORS as readonly string[]).includes(color)))
})
