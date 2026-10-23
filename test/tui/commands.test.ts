/**
 * Tests for /status-rotator command registration and dispatch
 * (src/tui/commands.ts).
 *
 * Imports the BUILT output (lib/types/tui/commands.js).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { STATUS_COMMAND_NAME, registerStatusCommand } from '../../lib/types/tui/commands.js'

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

/** Controller double wiring the command deps. */
function createDeps(overrides: Record<string, unknown> = {}) {
  const state = {
    nextCalls: 0,
    enabledValues: [] as boolean[],
    enabled: true,
    lang: 'zh' as 'zh' | 'en',
  }
  const deps = {
    next() {
      state.nextCalls += 1
    },
    setEnabled(on: boolean) {
      state.enabledValues.push(on)
      state.enabled = on
    },
    enabled() {
      return state.enabled
    },
    statusText() {
      return '状态轮换 enabled=on\ncurrent: 你好'
    },
    lang() {
      return state.lang
    },
    ...overrides,
  }
  return { deps, state }
}

/** A ports double with an optional mediated host / direct commands registry. */
function createPorts(options: { mediated?: boolean; direct?: boolean; mediatedThrows?: boolean } = {}) {
  const calls = {
    mediated: [] as { pluginCtx: unknown; definition: Record<string, unknown> }[],
    direct: [] as Record<string, unknown>[],
  }
  let disposed = 0
  const ports: Record<string, unknown> = { entryId: 'status-rotator' }
  if (options.mediated === true) {
    ports.pluginHost = {
      registerCommand(pluginCtx: unknown, definition: Record<string, unknown>) {
        if (options.mediatedThrows === true) throw new Error('command "status-rotator" is not bound to a declared contribution id')
        calls.mediated.push({ pluginCtx, definition })
        return () => {
          disposed += 1
        }
      },
    }
  }
  if (options.direct === true) {
    ports.commands = {
      register(definition: Record<string, unknown>) {
        calls.direct.push(definition)
        return () => {
          disposed += 1
        }
      },
    }
  }
  return { ports: ports as never, calls, disposed: () => disposed }
}

test('registerStatusCommand: prefers the mediated registration surface', () => {
  const { deps } = createDeps()
  const registry = createPorts({ mediated: true, direct: true })
  const ctx = { get: () => undefined }
  const dispose = registerStatusCommand(ctx as never, registry.ports, deps)
  assert.equal(typeof dispose, 'function')
  assert.equal(registry.calls.mediated.length, 1)
  assert.equal(registry.calls.direct.length, 0)
  const definition = registry.calls.mediated[0].definition
  assert.equal(definition.name, STATUS_COMMAND_NAME)
  assert.equal(typeof definition.description, 'string')
  assert.ok((definition.description as string).length > 0)
  assert.equal(typeof definition.handler, 'function')
  assert.equal(registry.calls.mediated[0].pluginCtx, ctx)
  dispose()
  dispose() // idempotent
  assert.equal(registry.disposed(), 1)
})

test('dispatch: status / no-argument returns the multi-line status snapshot', () => {
  const { deps } = createDeps()
  const registry = createPorts({ mediated: true })
  registerStatusCommand({ get: () => undefined } as never, registry.ports, deps)
  const handler = registry.calls.mediated[0].definition.handler as (input: unknown) => { kind: string; text?: string }
  assert.deepEqual(handler('status'), { kind: 'success', text: '状态轮换 enabled=on\ncurrent: 你好' })
  assert.deepEqual(handler(''), { kind: 'success', text: '状态轮换 enabled=on\ncurrent: 你好' })
  assert.deepEqual(handler('   STATUS  '), { kind: 'success', text: '状态轮换 enabled=on\ncurrent: 你好' })
})

test('dispatch: next / on / off call the controller and return localized messages', () => {
  const { deps, state } = createDeps()
  const registry = createPorts({ mediated: true })
  registerStatusCommand({ get: () => undefined } as never, registry.ports, deps)
  const handler = registry.calls.mediated[0].definition.handler as (input: unknown) => { kind: string; text?: string }

  const next = handler('next')
  assert.equal(next.kind, 'success')
  assert.equal(next.text, '已换下一句')
  assert.equal(state.nextCalls, 1)

  const off = handler('off')
  assert.equal(off.kind, 'success')
  assert.equal(off.text, '已停用（本次运行；长期设置请到 /settings）')
  assert.deepEqual(state.enabledValues, [false])

  const on = handler('on')
  assert.equal(on.kind, 'success')
  assert.equal(on.text, '已启用（本次运行；长期设置请到 /settings）')
  assert.deepEqual(state.enabledValues, [false, true])
})

test('dispatch: english messages follow deps.lang()', () => {
  const { deps, state } = createDeps()
  state.lang = 'en'
  const registry = createPorts({ mediated: true })
  registerStatusCommand({ get: () => undefined } as never, registry.ports, deps)
  const handler = registry.calls.mediated[0].definition.handler as (input: unknown) => { kind: string; text?: string }
  assert.equal(handler('next').text, 'advanced to the next phrase')
  assert.equal(handler('off').text, 'disabled for this run (persist via /settings)')
  assert.ok((registry.calls.mediated[0].definition.description as string).includes('Control the rotating status line'))
})

test('dispatch: unknown subcommands return a usage error', () => {
  const { deps } = createDeps()
  const registry = createPorts({ mediated: true })
  registerStatusCommand({ get: () => undefined } as never, registry.ports, deps)
  const handler = registry.calls.mediated[0].definition.handler as (input: unknown) => { kind: string; text?: string }
  const result = handler('rotate')
  assert.equal(result.kind, 'error')
  assert.ok(result.text.includes('next'))
  assert.ok(result.text.includes('rotate'))
})

test('dispatch: dsh-commands invocation objects are accepted', () => {
  const { deps, state } = createDeps()
  const registry = createPorts({ mediated: true })
  registerStatusCommand({ get: () => undefined } as never, registry.ports, deps)
  const handler = registry.calls.mediated[0].definition.handler as (input: unknown) => { kind: string; text?: string }
  const invocation = Object.freeze({ commandId: 'c1', agent: {}, rawInput: ' next ', attachments: [], signal: new AbortController().signal })
  assert.equal(handler(invocation).kind, 'success')
  assert.equal(state.nextCalls, 1)
  // Non-invocation garbage never throws.
  assert.equal(handler(null).kind, 'success')
  assert.equal(handler(42).kind, 'success')
  assert.equal(handler({}).kind, 'success')
})

test('dispatch: a throwing controller returns an error result, never rejects', async () => {
  const { deps } = createDeps({
    next() {
      throw new Error('controller exploded')
    },
  })
  const registry = createPorts({ mediated: true })
  registerStatusCommand({ get: () => undefined } as never, registry.ports, deps)
  const handler = registry.calls.mediated[0].definition.handler as (input: unknown) => { kind: string; text?: string }
  const result = handler('next')
  assert.equal(result.kind, 'error')
  assert.ok(result.text.includes('controller exploded'))
  // A throwing status snapshot is contained too.
  const statusDeps = createDeps({ statusText() { throw new Error('snapshot exploded') } })
  const second = createPorts({ mediated: true })
  registerStatusCommand({ get: () => undefined } as never, second.ports, statusDeps.deps)
  const secondHandler = second.calls.mediated[0].definition.handler as (input: unknown) => { kind: string; text?: string }
  assert.equal(secondHandler('status').kind, 'error')
  await Promise.resolve()
})

test('registration: falls back to the direct commands registry when the mediated surface is absent', () => {
  const { deps } = createDeps()
  const registry = createPorts({ direct: true })
  const dispose = registerStatusCommand({ get: () => undefined } as never, registry.ports, deps)
  assert.equal(typeof dispose, 'function')
  assert.equal(registry.calls.direct.length, 1)
  assert.equal(registry.calls.direct[0].name, STATUS_COMMAND_NAME)
})

test('registration: a rejected mediated registration falls back and reports the loss of attribution', () => {
  const { deps } = createDeps()
  const diagnostics = createDiagnostics()
  const registry = createPorts({ mediated: true, direct: true, mediatedThrows: true })
  const dispose = registerStatusCommand({ get: () => undefined } as never, registry.ports, {
    ...deps,
    diagnostics: diagnostics as never,
  })
  assert.equal(typeof dispose, 'function')
  assert.equal(registry.calls.direct.length, 1)
  const codes = diagnostics.entries.map(entry => entry.code)
  assert.ok(codes.includes('command.mediated-failed'))
  const message = diagnostics.entries.find(entry => entry.code === 'command.mediated-failed').message
  assert.ok(message.includes('not bound to a declared contribution id'))
})

test('registration: no surface at all yields undefined and a diagnostic', () => {
  const { deps } = createDeps()
  const diagnostics = createDiagnostics()
  const result = registerStatusCommand({ get: () => undefined } as never, { entryId: 'x' } as never, {
    ...deps,
    diagnostics: diagnostics as never,
  })
  assert.equal(result, undefined)
  assert.equal(diagnostics.entries[0].code, 'command.unavailable')
})

test('registration: a throwing direct register yields undefined and a diagnostic', () => {
  const { deps } = createDeps()
  const diagnostics = createDiagnostics()
  const ports = {
    entryId: 'x',
    commands: {
      register() {
        throw new Error('command "status-rotator" is already registered')
      },
    },
  }
  const result = registerStatusCommand({ get: () => undefined } as never, ports as never, {
    ...deps,
    diagnostics: diagnostics as never,
  })
  assert.equal(result, undefined)
  assert.equal(diagnostics.entries[0].code, 'command.register-failed')
})

test('registration: without a diagnostics sink failures are logged through ctx.logger', () => {
  const { deps } = createDeps()
  const logged: string[] = []
  const ctx = {
    get: () => undefined,
    logger: {
      warn(message: string) {
        logged.push(message)
      },
    },
  }
  const result = registerStatusCommand(ctx as never, { entryId: 'x' } as never, deps)
  assert.equal(result, undefined)
  assert.equal(logged.length, 1)
  assert.ok(logged[0].includes('command.unavailable'))
  assert.ok(logged[0].includes('dsh-tui-status-rotator'))
})
