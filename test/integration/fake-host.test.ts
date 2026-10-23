/**
 * Integration test: load the BUILT plugin (lib/types/index.js) into a fake
 * cordis context that mounts the dsh-TUI seams, drive it with the real session
 * event stream, and assert the end-to-end contract without a terminal:
 *
 *  - seam 11: tuiStatus.registerView gets key "status-rotator" / maxRows 1;
 *    the view component renders the current phrase through the host React
 *    instance and pointer-only UI kit (typewriter finished, gradient off);
 *  - seam 6: tuiSettingsSections gets the row's namespace and the 15 editable
 *    fields declared in src/config.ts;
 *  - dsh-commands: /status-rotator is registered through tuiPluginHost and
 *    "status" returns a success result that names the host seams;
 *  - lifecycle: turn/start -> assistant/chunk -> tool/call -> tool/result ->
 *    turn/end drives visibility; plugin unload runs the ctx.effect cleanup,
 *    clears its interval, releases every seam registration and stops the
 *    status line (TUI-OBS-001).
 *
 * The test imports ONLY built output (run `npm run build` first); it never
 * imports src/**.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const PLUGIN_FILE = join(ROOT, 'lib', 'types', 'index.js')
const BANK_FILE = join(ROOT, 'lib', 'types', 'bank', 'data.js')
if (!existsSync(PLUGIN_FILE)) {
  throw new Error('built plugin missing at ' + PLUGIN_FILE + ' — run "npm run build" before the integration test')
}

const plugin = await import(new URL('file://' + PLUGIN_FILE).href)
const bank = await import(new URL('file://' + BANK_FILE).href)

// ---------------------------------------------------------------------------
// Fake host
// ---------------------------------------------------------------------------

/** Minimal cordis-context stand-in: get/on/effect/logger/fiber/provide. */
function createFakeHost(options = {}) {
  const {
    fiberId = 'status-rotator',
    richView = true,
    plainSet = true,
    mediatedCommands = true,
    directCommands = true,
    settingsSection = true,
    services = {},
  } = options

  const record = {
    views: [],
    plainSets: [],
    settingsSections: [],
    mediatedCommands: [],
    directCommands: [],
    provided: new Map(),
    providedDisposed: [],
    loggerWarnings: [],
    listeners: new Map(),
    effects: [],
    effectCleanups: [],
  }
  const disposed = { view: 0, settings: 0, command: 0, directCommand: 0 }

  const tuiStatus = {}
  if (richView) {
    tuiStatus.registerView = (descriptor, identity) => {
      record.views.push({ descriptor, identity })
      return () => {
        disposed.view += 1
      }
    }
  }
  if (plainSet) {
    tuiStatus.set = (key, text) => {
      record.plainSets.push({ key, text })
      return () => {}
    }
  }

  const provided = new Map()
  const builtServices = {
        tuiStatus: (richView || plainSet) ? tuiStatus : undefined,
        tuiSettingsSections: settingsSection
          ? {
              register(section) {
                record.settingsSections.push(section)
                return () => {
                  disposed.settings += 1
                }
              },
            }
          : undefined,
        commands: directCommands
          ? {
              register(definition) {
                record.directCommands.push(definition)
                return () => {
                  disposed.directCommand += 1
                }
              },
            }
          : undefined,
        tuiPluginHost: mediatedCommands
          ? {
              registerCommand(pluginCtx, definition) {
                record.mediatedCommands.push({ pluginCtx, definition })
                return () => {
                  disposed.command += 1
                }
              },
            }
          : undefined,
  }
  const ctx = {
    get(name, _strict) {
      if (provided.has(name)) return provided.get(name)
      if (services !== null && typeof services === 'object' && name in services) return services[name]
      return builtServices[name]
    },
    on(event, listener) {
      const list = record.listeners.get(event) ?? []
      list.push(listener)
      record.listeners.set(event, list)
      return () => {}
    },
    effect(callback, _label) {
      const cleanup = callback()
      record.effects.push(callback)
      if (typeof cleanup === 'function') record.effectCleanups.push(cleanup)
      return () => {
        if (typeof cleanup === 'function') cleanup()
      }
    },
    provide(name, value) {
      provided.set(name, value)
      record.provided.set(name, value)
      return () => {
        provided.delete(name)
        record.provided.delete(name)
        record.providedDisposed.push(name)
      }
    },
    logger: {
      warn(message) {
        record.loggerWarnings.push(String(message))
      },
    },
    fiber: { entry: { options: { id: fiberId } } },
  }
  return {
    ctx,
    record,
    disposed,
    services,
    /** Deliver one cordis event to every listener registered by the plugin. */
    emit(event, ...args) {
      for (const listener of record.listeners.get(event) ?? []) listener(...args)
    },
    /** Emulate cordis activation dispose: run effect cleanups, drop listeners. */
    dispose() {
      for (let index = record.effectCleanups.length - 1; index >= 0; index -= 1) record.effectCleanups[index]()
      record.effectCleanups.length = 0
      record.listeners.clear()
    },
    registeredEvents() {
      return [...record.listeners.keys()]
    },
  }
}

/** Fake React with exactly the hooks the rich status view is allowed to use. */
function createFakeReact() {
  const seen = { snapshots: [], effects: [], subscriptions: 0 }
  const React = {
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children }
    },
    useState(initial) {
      const value = typeof initial === 'function' ? initial() : initial
      return [value, () => {}]
    },
    useSyncExternalStore(subscribe, getSnapshot) {
      seen.subscriptions += 1
      seen.snapshots.push(getSnapshot())
      subscribe(() => {})
      return getSnapshot()
    },
    useEffect(callback) {
      const cleanup = callback()
      if (typeof cleanup === 'function') seen.effects.push(cleanup)
      return undefined
    },
    useRef(initial) {
      return { current: initial }
    },
    useMemo(factory) {
      return factory()
    },
  }
  return { React, seen }
}

/** Pointer-only UI kit the host injects into rich status views. */
function createFakeUi(columns = 300) {
  const Text = function Text() {}
  const Box = function Box() {}
  const Image = function Image() {}
  return { Box, Text, Image, useTerminalSize: () => ({ columns, rows: 30 }) }
}

/** Flatten a fake element tree into its visible text. */
function flattenText(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(flattenText).join('')
  if (typeof node === 'object' && Array.isArray(node.children)) return flattenText(node.children)
  return ''
}

/** Render the registered view component once and return tree + frame. */
function renderView(fakeHost) {
  assert.equal(fakeHost.record.views.length, 1, 'the rich status view must be registered exactly once')
  const { descriptor } = fakeHost.record.views[0]
  const { React, seen } = createFakeReact()
  const ui = createFakeUi()
  const tree = descriptor.component({ React, ui })
  const frame = seen.snapshots[seen.snapshots.length - 1]
  return { tree, text: flattenText(tree), frame, seen }
}

const tempDirs = []
function tempBankPath() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-status-rotator-int-'))
  tempDirs.push(dir)
  return join(dir, 'bank.json')
}
test.after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

/** Base config: deterministic language, instant reveal, no gradient animation. */
function baseConfig() {
  return {
    enabled: true,
    language: 'zh',
    intervalMs: 500,
    typeSpeedMs: 0,
    thinkingMs: 15_000,
    longAfterMs: 60_000,
    weightedRandom: true,
    antiRepeatRecentLimit: 3,
    labelSource: 'phrases',
    gradientEnabled: false,
    gradientMode: 'theme',
    gradientDirection: 'rtl',
    gradientColors: '#ff5f6d,#ffc371',
    gradientDayColors: '#d92b4b,#c2410c',
    gradientSpeedSec: 4,
    bankPath: tempBankPath(),
  }
}

/** Count live timers created through the global timer functions. */
function trackTimers() {
  const real = {
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  }
  const active = new Map()
  globalThis.setInterval = (...args) => {
    const handle = real.setInterval(...args)
    active.set(handle, 'interval')
    return handle
  }
  globalThis.setTimeout = (...args) => {
    const handle = real.setTimeout(...args)
    active.set(handle, 'timeout')
    return handle
  }
  globalThis.clearInterval = (handle) => {
    active.delete(handle)
    return real.clearInterval(handle)
  }
  globalThis.clearTimeout = (handle) => {
    active.delete(handle)
    return real.clearTimeout(handle)
  }
  return {
    active,
    restore() {
      globalThis.setInterval = real.setInterval
      globalThis.clearInterval = real.clearInterval
      globalThis.setTimeout = real.setTimeout
      globalThis.clearTimeout = real.clearTimeout
    },
  }
}

/** One session object plus the observed event shapes dsh-TUI emits. */
function makeSession() {
  return { id: 'session-1', header: { id: 'session-1' } }
}

// ---------------------------------------------------------------------------
// Test 1: rich host, full lifecycle
// ---------------------------------------------------------------------------
test('built plugin: rich host lifecycle, seams, rendering and cleanup', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'], now: 1_000_000 })
  const timers = trackTimers()
  const host = createFakeHost({ fiberId: 'status-rotator' })
  try {
    plugin.apply(host.ctx, baseConfig())

    // ---- seam 11: rich view registration ----
    assert.equal(host.record.views.length, 1)
    const view = host.record.views[0]
    assert.equal(view.descriptor.key, 'status-rotator')
    assert.equal(view.descriptor.maxRows, 1)
    assert.equal(typeof view.descriptor.component, 'function')
    assert.equal(view.identity, host.ctx, 'the host registration must carry the plugin ctx as identity')

    // ---- seam 6: settings section ----
    assert.equal(host.record.settingsSections.length, 1)
    const section = host.record.settingsSections[0]
    assert.equal(section.ns, 'status-rotator')
    assert.equal(section.title, 'Status rotator')
    assert.deepEqual(section.descriptions, { zh: '状态轮换', en: 'Status rotator' })
    assert.equal(section.page?.id, 'status-rotator')
    assert.equal(section.fields.length, 15, 'the settings section must expose the 15 volatile config keys')
    const expectedKeys = [
      'enabled', 'language', 'intervalMs', 'typeSpeedMs', 'thinkingMs', 'longAfterMs',
      'weightedRandom', 'antiRepeatRecentLimit', 'labelSource', 'gradientEnabled',
      'gradientMode', 'gradientDirection', 'gradientColors', 'gradientDayColors', 'gradientSpeedSec',
    ]
    assert.deepEqual(section.fields.map(field => field.path), expectedKeys.map(key => [key]))
    for (const field of section.fields) {
      assert.ok(['text', 'number', 'boolean', 'select'].includes(field.kind), field.path.join('.') + ' kind')
      assert.equal(typeof field.label, 'string')
      assert.ok(field.label.length > 0)
      assert.equal(typeof field.descriptions?.zh, 'string')
      assert.equal(typeof field.descriptions?.en, 'string')
    }
    for (const selectKey of ['language', 'labelSource', 'gradientMode', 'gradientDirection']) {
      const field = section.fields.find(candidate => candidate.path[0] === selectKey)
      assert.ok(Array.isArray(field.options) && field.options.length > 0, selectKey + ' must be a select with options')
      for (const option of field.options) {
        assert.equal(typeof option.value, 'string')
        assert.equal(typeof option.label, 'string')
        assert.equal(typeof option.descriptions?.zh, 'string')
      }
    }

    // ---- dsh-commands: mediated registration ----
    assert.equal(host.record.mediatedCommands.length, 1)
    assert.equal(host.record.directCommands.length, 0, 'the mediated tuiPluginHost surface must win')
    const { pluginCtx, definition } = host.record.mediatedCommands[0]
    assert.equal(pluginCtx, host.ctx)
    assert.equal(definition.name, 'status-rotator')
    assert.equal(typeof definition.handler, 'function')

    // ---- extension API: ctx.statusRotator ----
    const service = host.ctx.get('statusRotator')
    assert.equal(typeof service, 'object')
    assert.equal(service.version, 1)
    const serviceStatus = service.status()
    assert.deepEqual(serviceStatus.host, {
      richStatusView: true,
      plainStatus: true,
      settingsSection: true,
      commands: true,
    })
    assert.equal(typeof serviceStatus.engine, 'object')
    assert.ok(Array.isArray(serviceStatus.diagnostics))

    // ---- idle: hidden (no session yet) ----
    const idle = renderView(host)
    assert.equal(idle.tree, null, 'the view must render nothing before a turn starts')
    assert.equal(idle.frame.visible, false)

    const statusResult = definition.handler('status')
    assert.equal(statusResult.kind, 'success')
    assert.match(statusResult.text, /状态轮换/u)
    assert.match(statusResult.text, /view=on/u)
    assert.match(statusResult.text, /set=on/u)
    assert.match(statusResult.text, /settings=on/u)
    assert.match(statusResult.text, /cmd=on/u)

    // ---- session/turn events drive the line ----
    const session = makeSession()
    host.emit('session/event', session, { type: 'turn/start', turn: 1 })
    const turnFrame = renderView(host)
    assert.equal(turnFrame.frame.visible, true)
    assert.equal(turnFrame.frame.phase, 'thinking')
    assert.equal(turnFrame.frame.lang, 'zh')
    assert.ok(turnFrame.frame.text.length > 1)
    assert.ok(turnFrame.frame.text.endsWith('…'), 'phrases from the shipped bank end with an ellipsis')
    assert.ok(turnFrame.text.includes(turnFrame.frame.text), 'the rendered tree must contain the phrase text')
    assert.ok(turnFrame.seen.subscriptions >= 1, 'the component must subscribe through the injected React')

    host.emit('session/event', session, { type: 'assistant/chunk', turn: 1, text: 'hello' })
    host.emit('session/event', session, { type: 'tool/call', turn: 1, callId: 'call-1', name: 'bash' })
    const toolFrame = renderView(host)
    assert.equal(toolFrame.frame.visible, true)
    host.emit('session/event', session, { type: 'tool/result', turn: 1, callId: 'call-1', name: 'bash' })

    // ---- time advance: thinking -> running (controller clock + interval) ----
    t.mock.timers.tick(16_000)
    const runningFrame = renderView(host)
    assert.equal(runningFrame.frame.visible, true)
    assert.equal(runningFrame.frame.phase, 'running', 'the phase must advance from thinking to running after thinkingMs')
    assert.ok(runningFrame.text.includes(runningFrame.frame.text))

    // ---- command: next forces a redraw ----
    const nextResult = definition.handler({ commandId: 'x', rawInput: 'next' })
    assert.equal(nextResult.kind, 'success')
    const nextFrame = renderView(host)
    assert.equal(nextFrame.frame.visible, true)
    assert.ok(nextFrame.frame.revision > runningFrame.frame.revision)

    // ---- extra subcommands + unknown ----
    assert.equal(definition.handler('off').kind, 'success')
    assert.equal(renderView(host).frame.visible, false, 'off must hide the line')
    assert.equal(definition.handler('on').kind, 'success')
    assert.equal(renderView(host).frame.visible, true, 'on must show the line again while the turn runs')
    const unknown = definition.handler('bogus')
    assert.equal(unknown.kind, 'error')
    assert.match(unknown.text, /未知子命令/u)

    // ---- turn/end hides the line ----
    host.emit('session/event', session, { type: 'turn/end', turn: 1 })
    assert.equal(renderView(host).frame.visible, false)

    // ---- lifecycle: unload must clean every registration and timer ----
    assert.ok(timers.active.size >= 1, 'the rotation interval must be running while the plugin is active')
    assert.ok(host.registeredEvents().includes('session/event'))
    assert.ok(host.registeredEvents().includes('agent/status'))
    assert.ok(host.registeredEvents().includes('session/disposed'))
    assert.ok(host.registeredEvents().includes('loader/volatile-update'))
    assert.equal(host.record.effectCleanups.length >= 1, true, 'the plugin must register one ctx.effect cleanup')

    host.dispose()
    assert.equal(timers.active.size, 0, 'plugin unload must clear the rotation interval (no timers left)')
    assert.equal(host.record.listeners.size, 0, 'the host scope drops the plugin listeners on unload')
    assert.equal(host.disposed.view >= 1, true, 'the rich view disposer must run on unload')
    assert.equal(host.disposed.settings >= 1, true, 'the settings section disposer must run on unload')
    assert.equal(host.disposed.command >= 1, true, 'the command disposer must run on unload')
    assert.deepEqual(host.record.providedDisposed, ['statusRotator'], 'the provided extension service must be disposed on unload')
    assert.equal(host.ctx.get('statusRotator'), undefined)
    // The view store is hidden and the frame is cleared on unload.
    const afterUnload = renderView(host)
    assert.equal(afterUnload.frame.visible, false, 'unload must stop the status line')
    assert.equal(afterUnload.tree, null)
    // The plugin never reported a cleanup/runtime failure.
    assert.equal(host.record.loggerWarnings.some(message => message.includes('cleanup.failed')), false)
  } finally {
    timers.restore()
    t.mock.timers.reset()
  }
})

// ---------------------------------------------------------------------------
// Test 2: plain-text fallback when the host has no registerView
// ---------------------------------------------------------------------------
test('built plugin: plain tuiStatus.set fallback when rich views are unavailable', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'], now: 2_000_000 })
  const timers = trackTimers()
  const host = createFakeHost({ richView: false, plainSet: true })
  try {
    plugin.apply(host.ctx, baseConfig())
    assert.equal(host.record.views.length, 0)
    // One diagnostic must name the degradation.
    assert.ok(host.record.loggerWarnings.some(message => /rich status views are unavailable|registerView/u.test(message)) ||
      host.record.loggerWarnings.some(message => message.includes('status-rotator')), 'the degradation must be visible in diagnostics')

    host.emit('session/event', makeSession(), { type: 'turn/start', turn: 1 })
    const writes = host.record.plainSets.filter(entry => typeof entry.text === 'string' && entry.text.length > 0)
    assert.ok(writes.length >= 1, 'the fallback must write the rotating line through tuiStatus.set')
    assert.equal(writes[writes.length - 1].key, 'status-rotator')
    assert.ok(writes[writes.length - 1].text.endsWith('…'))

    const definition = host.record.mediatedCommands[0].definition
    const statusResult = definition.handler('status')
    assert.match(statusResult.text, /view=off/u)
    assert.match(statusResult.text, /set=on/u)

    host.dispose()
    assert.equal(timers.active.size, 0, 'the fallback path must also stop its timer')
    const lastWrite = host.record.plainSets[host.record.plainSets.length - 1]
    assert.equal(lastWrite.text, undefined, 'the fallback must clear its key on unload')
  } finally {
    timers.restore()
    t.mock.timers.reset()
  }
})

// ---------------------------------------------------------------------------
// Test 3: commands-only host (no mediated surface) still registers the command
// ---------------------------------------------------------------------------
test('built plugin: direct commands.register fallback when tuiPluginHost is absent', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'], now: 3_000_000 })
  const timers = trackTimers()
  const host = createFakeHost({ mediatedCommands: false, directCommands: true, settingsSection: false })
  try {
    plugin.apply(host.ctx, baseConfig())
    assert.equal(host.record.mediatedCommands.length, 0)
    assert.equal(host.record.directCommands.length, 1)
    assert.equal(host.record.directCommands[0].name, 'status-rotator')
    assert.equal(host.record.settingsSections.length, 0, 'a missing settings seam must not throw or fabricate a section')

    host.emit('session/event', makeSession(), { type: 'turn/start', turn: 1 })
    const result = host.record.directCommands[0].handler('status')
    assert.equal(result.kind, 'success')
    assert.match(result.text, /状态轮换/u)
    assert.match(result.text, /settings=off/u)

    host.dispose()
    assert.equal(timers.active.size, 0)
    assert.equal(host.disposed.directCommand, 1, 'the direct command disposer must run on unload')
  } finally {
    timers.restore()
    t.mock.timers.reset()
  }
})

// ---------------------------------------------------------------------------
// Test 4: no TUI seams at all — apply must not throw, every absence is a
// diagnostic, and unloading is still clean.
// ---------------------------------------------------------------------------
test('built plugin: bare context degrades to a diagnosed no-op and unloads cleanly', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'], now: 4_000_000 })
  const timers = trackTimers()
  const host = createFakeHost({ richView: false, plainSet: false, mediatedCommands: false, directCommands: false, settingsSection: false })
  try {
    assert.doesNotThrow(() => plugin.apply(host.ctx, baseConfig()))
    const warnings = host.record.loggerWarnings.join('\n')
    for (const code of ['host.missing-tuiStatus', 'host.missing-tuiSettingsSections', 'host.missing-commands', 'host.missing-tuiPluginHost']) {
      assert.ok(warnings.includes(code), 'expected diagnostic ' + code)
    }
    assert.equal(host.record.views.length, 0)
    assert.equal(host.record.settingsSections.length, 0)
    assert.equal(host.record.mediatedCommands.length + host.record.directCommands.length, 0)
    // The extension API is still provided for other plugins.
    assert.equal(typeof host.ctx.get('statusRotator').status, 'function')

    host.emit('session/event', makeSession(), { type: 'turn/start', turn: 1 })
    host.dispose()
    assert.equal(timers.active.size, 0, 'a no-op host must not leak the controller interval')
    assert.equal(host.record.listeners.size, 0)
  } finally {
    timers.restore()
    t.mock.timers.reset()
  }
})

// ---------------------------------------------------------------------------
// Test 5: the settings namespace follows the Loader entry id (row id)
// ---------------------------------------------------------------------------
test('built plugin: settings namespace follows fiber.entry.options.id', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'], now: 5_000_000 })
  const timers = trackTimers()
  const host = createFakeHost({ fiberId: 'custom-row' })
  try {
    plugin.apply(host.ctx, baseConfig())
    const section = host.record.settingsSections[0]
    assert.equal(section.ns, 'custom-row')
    assert.equal(section.page?.id, 'custom-row')
    host.dispose()
    assert.equal(timers.active.size, 0)
  } finally {
    timers.restore()
    t.mock.timers.reset()
  }
})