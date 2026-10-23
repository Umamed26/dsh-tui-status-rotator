/**
 * Tests for the plain-text status bridge (src/tui/plain-status.ts): the
 * degraded seam 11 surface used when the host has no `registerView`.
 *
 * Imports the BUILT output (lib/types/tui/plain-status.js).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { PLAIN_STATUS_KEY, createPlainStatusBridge } from '../../lib/types/tui/plain-status.js'

/** Collect diagnostics. */
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

test('missing tuiStatus.set degrades with a diagnostic, no throw', () => {
  const diagnostics = createDiagnostics()
  assert.equal(createPlainStatusBridge({ entryId: 'x' } as never, diagnostics as never), undefined)
  assert.equal(diagnostics.entries[0].code, 'status.plain-unavailable')
  assert.equal(createPlainStatusBridge({ entryId: 'x', status: {} } as never, diagnostics as never), undefined)
})

test('update writes the keyed contribution and clears with undefined', () => {
  const calls: unknown[][] = []
  const ports = {
    entryId: 'x',
    status: {
      set(key: string, text: string | undefined) {
        calls.push([key, text])
        return () => {}
      },
      registerView() {
        return undefined
      },
    },
  }
  const bridge = createPlainStatusBridge(ports as never, createDiagnostics() as never)
  assert.ok(bridge !== undefined)
  bridge.update('构建中 42%')
  bridge.update(undefined)
  bridge.update('')
  assert.deepEqual(calls, [
    [PLAIN_STATUS_KEY, '构建中 42%'],
    [PLAIN_STATUS_KEY, undefined],
    [PLAIN_STATUS_KEY, undefined],
  ])
})

test('text is flattened to one line and capped at 200 cells', () => {
  const calls: (string | undefined)[] = []
  const ports = {
    entryId: 'x',
    status: {
      set(_key: string, text: string | undefined) {
        calls.push(text)
        return () => {}
      },
      registerView() {
        return undefined
      },
    },
  }
  const bridge = createPlainStatusBridge(ports as never, createDiagnostics() as never)
  bridge.update('  line one\n  line two  ')
  assert.equal(calls[0], 'line one line two')
  bridge.update('x'.repeat(500))
  assert.equal(typeof calls[1], 'string')
  assert.equal((calls[1] as string).length, 200)
  assert.ok((calls[1] as string).endsWith('…'))
  bridge.update('   ')
  assert.equal(calls[2], undefined)
})

test('the host token disposer is released before the next write and on dispose', () => {
  const order: string[] = []
  const calls: (string | undefined)[] = []
  const ports = {
    entryId: 'x',
    status: {
      set(_key: string, text: string | undefined) {
        calls.push(text)
        const token = calls.length
        return () => {
          order.push('dispose-' + token)
        }
      },
      registerView() {
        return undefined
      },
    },
  }
  const bridge = createPlainStatusBridge(ports as never, createDiagnostics() as never)
  assert.ok(bridge !== undefined)
  bridge.update('one') // returns disposer 1
  bridge.update('two') // releases disposer 1, returns disposer 2
  assert.deepEqual(order, ['dispose-1'])
  bridge.dispose()
  assert.deepEqual(order, ['dispose-1', 'dispose-2'])
  // dispose also clears the key explicitly
  assert.equal(calls[calls.length - 1], undefined)
  // updates after dispose are ignored
  const before = calls.length
  bridge.update('ignored')
  assert.equal(calls.length, before)
})

test('a host that returns void from set is handled', () => {
  const calls: (string | undefined)[] = []
  const ports = {
    entryId: 'x',
    status: {
      set(_key: string, text: string | undefined) {
        calls.push(text)
      },
      registerView() {
        return undefined
      },
    },
  }
  const bridge = createPlainStatusBridge(ports as never, createDiagnostics() as never)
  assert.ok(bridge !== undefined)
  bridge.update('hello')
  bridge.dispose()
  assert.equal(calls[0], 'hello')
  assert.equal(calls[1], undefined)
})

test('a throwing set becomes a diagnostic, never a throw', () => {
  const diagnostics = createDiagnostics()
  const ports = {
    entryId: 'x',
    status: {
      set() {
        throw new Error('set exploded')
      },
      registerView() {
        return undefined
      },
    },
  }
  const bridge = createPlainStatusBridge(ports as never, diagnostics as never)
  assert.ok(bridge !== undefined)
  bridge.update('hello')
  assert.equal(diagnostics.entries.length, 1)
  assert.equal(diagnostics.entries[0].code, 'status.plain-failed')
  assert.ok(diagnostics.entries[0].message.includes('set exploded'))
})
