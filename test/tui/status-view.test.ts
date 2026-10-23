/**
 * Tests for the rich status view (src/tui/status-view.ts): the component is
 * called directly with a fake host React / UI kit (the same tests dsh-TUI runs
 * for plugin scenes); registration behavior is tested with service doubles.
 *
 * Imports the BUILT output (lib/types/tui/status-view.js).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  STATUS_VIEW_KEY,
  STATUS_VIEW_MAX_ROWS,
  createStatusViewComponent,
  registerRichStatus,
} from '../../lib/types/tui/status-view.js'
import { gradientColors } from '../../lib/types/engine/render.js'

/** Fake element produced by the fake React.createElement. */
function createFakeReact() {
  const effects: boolean[] = []
  const React = {
    createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) {
      const merged: Record<string, unknown> = { ...(props ?? {}) }
      if (children.length === 1) merged.children = children[0]
      else if (children.length > 1) merged.children = children
      return { type, props: merged }
    },
    useSyncExternalStore(_subscribe: unknown, getSnapshot: () => unknown) {
      return getSnapshot()
    },
    useState(initial: unknown) {
      return [typeof initial === 'function' ? initial() : initial, () => {}]
    },
    useEffect(effect: () => unknown) {
      const cleanup = effect()
      effects.push(typeof cleanup === 'function')
      if (typeof cleanup === 'function') cleanup()
      return undefined
    },
  }
  return { React, effects }
}

/** Fake host UI kit: Box/Text/Image markers + terminal size. */
function createFakeUi(columns: number | null = 80) {
  function Box(props: Record<string, unknown>) {
    return { kind: 'box', props }
  }
  function Text(props: Record<string, unknown>) {
    return { kind: 'text', props }
  }
  function Image(props: Record<string, unknown>) {
    return { kind: 'image', props }
  }
  const ui: Record<string, unknown> = { Box, Text, Image }
  if (columns !== null) ui.useTerminalSize = () => ({ columns, rows: 24 })
  return ui
}

/** Minimal ViewStoreLike double. */
function createStore(initial: Record<string, unknown>) {
  let current = initial
  const listeners = new Set<() => void>()
  return {
    get snapshot() {
      return current
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    publish(next: Record<string, unknown>) {
      current = next
      for (const listener of [...listeners]) listener()
    },
    listenerCount() {
      return listeners.size
    },
  }
}

/** A complete ViewFrame-like object. */
function frame(overrides: Record<string, unknown> = {}) {
  return {
    revision: 1,
    visible: true,
    phase: 'running',
    lang: 'zh',
    text: '你好',
    startedAt: 0,
    typeSpeedMs: 0,
    ...overrides,
  }
}

/** Walk an element tree, collecting every node with a predicate. */
function collect(node: unknown, predicate: (element: Record<string, unknown>) => boolean, out: Record<string, unknown>[] = []) {
  if (node === null || node === undefined) return out
  if (Array.isArray(node)) {
    for (const child of node) collect(child, predicate, out)
    return out
  }
  if (typeof node === 'object') {
    const element = node as Record<string, unknown>
    if (predicate(element)) out.push(element)
    const props = element.props as Record<string, unknown> | undefined
    if (props !== undefined) collect(props.children, predicate, out)
  }
  return out
}

/** Flatten the text content of an element tree. */
function textOf(node: unknown): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node === null || typeof node !== 'object') return ''
  const props = (node as { props?: Record<string, unknown> }).props
  return props === undefined ? '' : textOf(props.children)
}

/** Render the component once with fake host primitives. */
function render(store: ReturnType<typeof createStore>, options: { columns?: number | null } = {}) {
  const { React, effects } = createFakeReact()
  const ui = createFakeUi(options.columns === undefined ? 80 : options.columns)
  const view = createStatusViewComponent(store as never)
  const tree = view({ React, ui } as never)
  return { tree, ui, effects }
}

/** The line Text element (the one the component marks with wrap). */
function lineElement(tree: unknown) {
  const found = collect(tree, element => {
    const props = element.props as Record<string, unknown> | undefined
    return props !== undefined && props.wrap === 'truncate-end'
  })
  return found[0]
}

/** The dim phase-indicator text content. */
function indicatorText(tree: unknown): string {
  const found = collect(tree, element => {
    const props = element.props as Record<string, unknown> | undefined
    return props !== undefined && props.dimColor === true && typeof props.children === 'string' && props.children.endsWith(' ')
  })
  return found.length === 0 ? '' : textOf(found[0])
}

test('hidden frame renders null and reserves no row', () => {
  const store = createStore(frame({ visible: false }))
  const { tree, effects } = render(store)
  assert.equal(tree, null)
  // Hooks stay unconditional; the effect must decide "no animation", not be skipped.
  assert.deepEqual(effects, [false])
})

test('visible frame renders the phase indicator and the full text (speed 0)', () => {
  const cases = [
    { phase: 'thinking', symbol: '◌' },
    { phase: 'running', symbol: '●' },
    { phase: 'long', symbol: '◍' },
  ]
  for (const entry of cases) {
    const store = createStore(frame({ phase: entry.phase, text: '构建中 42%' }))
    const { tree, effects } = render(store)
    assert.notEqual(tree, null)
    assert.equal(indicatorText(tree), entry.symbol + ' ')
    assert.equal(textOf(lineElement(tree)), '构建中 42%')
    // Fully revealed and no gradient: no animation timer.
    assert.deepEqual(effects, [false])
  }
})

test('an unknown phase degrades to the neutral indicator', () => {
  const store = createStore(frame({ phase: 'mystery' }))
  const { tree } = render(store)
  assert.equal(indicatorText(tree), '· ')
})

test('typewriter reveals only the elapsed graphemes and schedules a timer', () => {
  const store = createStore(frame({ text: 'abcd', startedAt: Date.now(), typeSpeedMs: 100_000 }))
  const { tree, effects } = render(store)
  assert.equal(textOf(lineElement(tree)), 'a')
  assert.deepEqual(effects, [true], 'still typing => timer scheduled')
})

test('gradient paints one host color per revealed grapheme', () => {
  const gradient = { mode: 'night', direction: 'rtl', palette: ['#111111', '#222222', '#333333'], speedMs: 1_000_000 }
  // Anchor the phrase at "now": the view derives the sweep from
  // (Date.now() - startedAt), so a startedAt of 0 would land on an arbitrary
  // step instead of the intended zero.
  const store = createStore(frame({ text: 'abcd', gradient, startedAt: Date.now() }))
  const { tree, ui } = render(store)
  const line = lineElement(tree)
  assert.ok(line !== undefined)
  const spans = collect(line, element => element.type === (ui as Record<string, unknown>).Text)
  // The line element itself is also a Text; spans are its children.
  const children = (line.props as Record<string, unknown>).children
  const colored = (Array.isArray(children) ? children : [children]).filter(
    (child: unknown) => typeof child === 'object' && child !== null && (child as { type?: unknown }).type === (ui as Record<string, unknown>).Text,
  )
  assert.equal(colored.length, 4)
  const colors = colored.map(child => (child as { props: Record<string, unknown> }).props.color)
  // speedMs is huge relative to the test duration: step stays 0.
  assert.deepEqual(colors, ['#111111', '#222222', '#333333', '#111111'])
  assert.equal(textOf(children), 'abcd')
  assert.ok(spans.length >= 4)
})

test('a gradient with an unusable palette falls back to plain colored text', () => {
  const store = createStore(frame({ text: 'abcd', gradient: { mode: 'day', direction: 'ltr', palette: [], speedMs: 1000 } }))
  const { tree } = render(store)
  assert.equal(textOf(lineElement(tree)), 'abcd')
})

test('narrow terminals clip the line with an ellipsis', () => {
  const store = createStore(frame({ text: 'abcdefghij' }))
  const { tree } = render(store, { columns: 8 }) // 8 cells - 2 indicator cells = 6
  assert.equal(textOf(lineElement(tree)), 'abcde…')
})

test('CJK graphemes count as two cells when clipping', () => {
  const store = createStore(frame({ text: '你好世界' }))
  const { tree } = render(store, { columns: 6 }) // 4 cells budget: 2 CJK fit, ellipsis reserved
  assert.equal(textOf(lineElement(tree)), '你…')
})

test('without a terminal size the view renders the whole phrase', () => {
  const store = createStore(frame({ text: 'a'.repeat(120) }))
  const { tree, effects } = render(store, { columns: null })
  assert.equal(textOf(lineElement(tree)), 'a'.repeat(120))
  assert.deepEqual(effects, [false])
})

test('a hidden frame after a visible one renders null again', () => {
  const store = createStore(frame({ text: 'hello' }))
  const first = render(store)
  assert.equal(textOf(lineElement(first.tree)), 'hello')
  store.publish(frame({ visible: false }))
  const second = render(store)
  assert.equal(second.tree, null)
})

test('the component subscribes to the store and renders frame updates', () => {
  const store = createStore(frame({ text: 'first' }))
  const view = createStatusViewComponent(store as never)
  const { React } = createFakeReact()
  const ui = createFakeUi(80)
  assert.equal(textOf(lineElement(view({ React, ui } as never))), 'first')
  store.publish(frame({ text: 'second', revision: 2 }))
  assert.equal(textOf(lineElement(view({ React, ui } as never))), 'second')
})

/** Collect diagnostics for registration tests. */
function createDiagnostics() {
  const entries: { code: string; message: string }[] = []
  return {
    entries,
    warn(code: string, message: string) {
      entries.push({ code, message })
    },
    list() {
      return entries.slice()
    },
  }
}

test('registerRichStatus: registers key/maxRows/component with our ctx as identity', () => {
  const registrations: { descriptor: Record<string, unknown>; identity: unknown }[] = []
  let disposed = 0
  const ports = {
    entryId: 'status-rotator',
    status: {
      set() {
        return () => {}
      },
      registerView(descriptor: Record<string, unknown>, identity?: unknown) {
        registrations.push({ descriptor, identity })
        return () => {
          disposed += 1
        }
      },
    },
  }
  const diagnostics = createDiagnostics()
  const ctx = { get: () => undefined }
  const store = createStore(frame())
  const dispose = registerRichStatus(ctx as never, ports as never, store as never, diagnostics as never)
  assert.equal(typeof dispose, 'function')
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].descriptor.key, STATUS_VIEW_KEY)
  assert.equal(registrations[0].descriptor.maxRows, STATUS_VIEW_MAX_ROWS)
  assert.equal(typeof registrations[0].descriptor.component, 'function')
  assert.equal(registrations[0].identity, ctx)
  assert.equal(diagnostics.entries.length, 0)
  dispose()
  assert.equal(disposed, 1)
})

test('registerRichStatus: missing tuiStatus/registerView degrades with a diagnostic', () => {
  const diagnostics = createDiagnostics()
  const store = createStore(frame())
  assert.equal(registerRichStatus({ get: () => undefined } as never, { entryId: 'x' } as never, store as never, diagnostics as never), undefined)
  assert.equal(diagnostics.entries[0].code, 'status.register-view')
  assert.equal(registerRichStatus(
    { get: () => undefined } as never,
    { entryId: 'x', status: { set() { return undefined } } } as never,
    store as never,
    diagnostics as never,
  ), undefined)
  assert.equal(diagnostics.entries[1].code, 'status.register-view')
})

test('registerRichStatus: a host refusal becomes a diagnostic, not a throw', () => {
  const diagnostics = createDiagnostics()
  const ports = {
    entryId: 'x',
    status: {
      set() {
        return () => {}
      },
      registerView() {
        return undefined
      },
    },
  }
  const result = registerRichStatus({ get: () => undefined } as never, ports as never, createStore(frame()) as never, diagnostics as never)
  assert.equal(result, undefined)
  assert.equal(diagnostics.entries[0].code, 'status.register-view-refused')
})

test('registerRichStatus: a throwing registerView becomes a diagnostic', () => {
  const diagnostics = createDiagnostics()
  const ports = {
    entryId: 'x',
    status: {
      set() {
        return () => {}
      },
      registerView() {
        throw new Error('host exploded')
      },
    },
  }
  const result = registerRichStatus({ get: () => undefined } as never, ports as never, createStore(frame()) as never, diagnostics as never)
  assert.equal(result, undefined)
  assert.equal(diagnostics.entries[0].code, 'status.register-view-failed')
  assert.ok(diagnostics.entries[0].message.includes('host exploded'))
})