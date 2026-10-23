/**
 * Tests for the dsh-TUI host seam probe (src/tui/host.ts).
 *
 * Imports the BUILT output (lib/types/tui/host.js) - run `npm run build`
 * first (the package test script does).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  disposeAll,
  probeHostPorts,
  resolveEntryId,
  safeDispose,
} from '../../lib/types/tui/host.js'

/** Collects diagnostics into a flat array. */
function createDiagnostics() {
  const entries: { code: string; message: string }[] = []
  return {
    entries,
    warn(code: string, message: string): void {
      entries.push({ code, message })
    },
    list() {
      return entries.slice()
    },
  }
}

/** A logger double recording every warn line. */
function createLogger() {
  const lines: string[] = []
  return {
    lines,
    warn(message: string): void {
      lines.push(message)
    },
  }
}

/** Build a fake structural context over a service map. */
function createContext(
  services: Record<string, unknown>,
  options: { entryId?: string; getThrows?: boolean; noGet?: boolean; logger?: { warn(message: string): void } } = {},
) {
  const ctx: Record<string, unknown> = {}
  if (options.noGet !== true) {
    ctx.get = (name: string, _strict?: boolean): unknown => {
      if (options.getThrows === true) throw new Error('host exploded')
      return services[name]
    }
  }
  if (options.logger !== undefined) ctx.logger = options.logger
  if (options.entryId !== undefined) {
    ctx.fiber = { entry: { options: { id: options.entryId } } }
  }
  return ctx
}

/** All five seam doubles; each records its calls. */
function createSeams() {
  const calls = {
    statusSet: [] as unknown[][],
    statusViews: [] as unknown[][],
    sections: [] as unknown[],
    commands: [] as unknown[],
    mediatedCommands: [] as unknown[],
    prompts: [] as unknown[],
  }
  const status = {
    set(key: string, text: string | undefined) {
      calls.statusSet.push([key, text])
      return () => {}
    },
    registerView(descriptor: unknown, identity?: unknown) {
      calls.statusViews.push([descriptor, identity])
      return () => {}
    },
  }
  const settingsSections = {
    register(section: unknown) {
      calls.sections.push(section)
      return () => {}
    },
  }
  const commands = {
    register(definition: unknown) {
      calls.commands.push(definition)
      return () => {}
    },
  }
  const pluginHost = {
    registerCommand(pluginCtx: unknown, definition: unknown) {
      calls.mediatedCommands.push([pluginCtx, definition])
      return () => {}
    },
  }
  const prompt = {
    register(name: string) {
      calls.prompts.push([name])
      return { set() {}, dispose() {} }
    },
  }
  return { calls, status, settingsSections, commands, pluginHost, prompt }
}

/** Codes present in a diagnostics list. */
function codes(entries: readonly { code: string }[]): string[] {
  return entries.map(entry => entry.code)
}

test('probeHostPorts: full composition exposes every seam and reports nothing', () => {
  const seams = createSeams()
  const logger = createLogger()
  const ctx = createContext({
    tuiStatus: seams.status,
    tuiSettingsSections: seams.settingsSections,
    commands: seams.commands,
    tuiPluginHost: seams.pluginHost,
    tuiPrompt: seams.prompt,
  }, { entryId: 'status-rotator', logger })

  const result = probeHostPorts(ctx as never, 'fallback-id')
  assert.equal(result.diagnostics.length, 0)
  assert.equal(result.ports.entryId, 'status-rotator')
  assert.equal(result.ports.status, seams.status)
  assert.equal(result.ports.settingsSections, seams.settingsSections)
  assert.equal(result.ports.commands, seams.commands)
  assert.equal(result.ports.pluginHost, seams.pluginHost)
  assert.equal(result.ports.prompt, seams.prompt)
})

test('probeHostPorts: missing seams degrade feature by feature with diagnostics', () => {
  const ctx = createContext({})
  const result = probeHostPorts(ctx as never, 'status-rotator')
  assert.equal(result.ports.status, undefined)
  assert.equal(result.ports.settingsSections, undefined)
  assert.equal(result.ports.commands, undefined)
  assert.equal(result.ports.pluginHost, undefined)
  assert.equal(result.ports.prompt, undefined)
  assert.equal(result.ports.entryId, 'status-rotator')
  const found = codes(result.diagnostics)
  for (const code of [
    'host.missing-tuiStatus',
    'host.missing-tuiSettingsSections',
    'host.missing-commands',
    'host.missing-tuiPluginHost',
    'host.missing-tuiPrompt',
  ]) {
    assert.ok(found.includes(code), 'expected diagnostic ' + code + ', got ' + found.join(','))
  }
  for (const entry of result.diagnostics) {
    assert.ok(typeof entry.message === 'string' && entry.message.length > 0)
  }
})

test('probeHostPorts: a throwing ctx.get is reported, never propagated', () => {
  const ctx = createContext({}, { getThrows: true })
  const result = probeHostPorts(ctx as never, 'status-rotator')
  const found = codes(result.diagnostics)
  assert.ok(found.includes('host.probe-failed'))
  assert.ok(found.includes('host.missing-tuiStatus'))
  assert.equal(result.ports.status, undefined)
})

test('probeHostPorts: a context without ctx.get degrades with host.no-context', () => {
  const result = probeHostPorts(createContext({}, { noGet: true }) as never, 'fallback')
  const found = codes(result.diagnostics)
  assert.ok(found.includes('host.no-context'))
  assert.ok(found.includes('host.missing-tuiStatus'))
  assert.equal(result.ports.entryId, 'fallback')
})

test('probeHostPorts: malformed services are rejected without throwing', () => {
  const result = probeHostPorts(createContext({
    tuiStatus: {},
    tuiSettingsSections: { register: 42 },
    commands: {},
    tuiPluginHost: { registerCommand: 'nope' },
    tuiPrompt: {},
  }) as never, 'status-rotator')
  const found = codes(result.diagnostics)
  assert.ok(found.includes('host.invalid-tuiStatus'))
  assert.ok(found.includes('host.invalid-tuiSettingsSections'))
  assert.ok(found.includes('host.invalid-commands'))
  assert.ok(found.includes('host.invalid-tuiPluginHost'))
  assert.ok(found.includes('host.invalid-tuiPrompt'))
  assert.equal(result.ports.status, undefined)
  assert.equal(result.ports.settingsSections, undefined)
  assert.equal(result.ports.commands, undefined)
  assert.equal(result.ports.pluginHost, undefined)
  assert.equal(result.ports.prompt, undefined)
})

test('probeHostPorts: tuiStatus with set() but no registerView reports the rich-view downgrade', () => {
  const status = { set() { return () => {} } }
  const result = probeHostPorts(createContext({ tuiStatus: status }) as never, 'status-rotator')
  assert.equal(result.ports.status, status)
  assert.ok(codes(result.diagnostics).includes('host.no-registerView'))
})

test('probeHostPorts: a getter that throws while type-checking is contained', () => {
  const hostile = Object.defineProperty({}, 'set', {
    get() {
      throw new Error('hostile getter')
    },
  })
  const result = probeHostPorts(createContext({ tuiStatus: hostile }) as never, 'status-rotator')
  assert.ok(codes(result.diagnostics).includes('host.invalid-tuiStatus'))
  assert.equal(result.ports.status, undefined)
})

test('resolveEntryId: Loader entry id wins, fallback applies otherwise', () => {
  assert.equal(resolveEntryId({ fiber: { entry: { options: { id: '  status-rotator  ' } } } } as never, 'fallback'), 'status-rotator')
  assert.equal(resolveEntryId({ fiber: { entry: { options: { id: 'row-id' } } } } as never, 'fallback'), 'row-id')
  assert.equal(resolveEntryId({} as never, 'fallback'), 'fallback')
  assert.equal(resolveEntryId(undefined, 'fallback'), 'fallback')
  assert.equal(resolveEntryId({ fiber: { entry: { options: { id: '   ' } } } } as never, 'fallback'), 'fallback')
  assert.equal(resolveEntryId({ get: () => undefined } as never, '   '), 'status-rotator')
  const hostile = {
    get() {
      throw new Error('boom')
    },
    get fiber(): never {
      throw new Error('fiber boom')
    },
  }
  assert.equal(resolveEntryId(hostile as never, 'safe-fallback'), 'safe-fallback')
})

test('safeDispose: runs a function, ignores non-functions, reports throws', () => {
  const diagnostics = createDiagnostics()
  let ran = 0
  assert.equal(safeDispose(() => { ran += 1 }, diagnostics as never), true)
  assert.equal(ran, 1)
  assert.equal(safeDispose(undefined, diagnostics as never), false)
  assert.equal(safeDispose(42, diagnostics as never), false)
  assert.equal(safeDispose(() => { throw new Error('cleanup broke') }, diagnostics as never), false)
  assert.equal(diagnostics.entries.length, 1)
  assert.equal(diagnostics.entries[0].code, 'cleanup.failed')
  assert.ok(diagnostics.entries[0].message.includes('cleanup broke'))
})

test('safeDispose: a hostile diagnostics sink cannot break cleanup', () => {
  const sink = {
    warn() {
      throw new Error('sink exploded')
    },
    list() {
      return []
    },
  }
  let ran = 0
  assert.equal(safeDispose(() => { ran += 1 }, sink as never, 'cleanup.failed'), true)
  assert.equal(ran, 1)
  assert.equal(safeDispose(() => { throw new Error('failure') }, sink as never), false)
})

test('disposeAll: reverse order, failures isolated', () => {
  const order: string[] = []
  const diagnostics = createDiagnostics()
  disposeAll([
    () => { order.push('first') },
    () => { order.push('second') },
    () => { throw new Error('third failed') },
    () => { order.push('fourth') },
  ], diagnostics as never)
  assert.deepEqual(order, ['fourth', 'second', 'first'])
  assert.equal(diagnostics.entries.length, 1)
})

test('disposeAll: empty list is a no-op', () => {
  const diagnostics = createDiagnostics()
  disposeAll([], diagnostics as never)
  assert.equal(diagnostics.entries.length, 0)
})
