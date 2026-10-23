/**
 * End-to-end seam lifecycle tests: boot the BUILT plugin entry
 * (lib/types/index.js) through a fake cordis ctx and assert that registrations
 * are bound to the plugin's own teardown effect, that the plain fallback is
 * driven on rotation, and that degraded hosts boot as a documented no-op.
 *
 * This covers the "disposer called on plugin unload" half of the seam
 * contract; the per-module unit tests live in the sibling files.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../../lib/types/index.js'

/** Boot the plugin with a fake cordis ctx; returns handles for assertions. */
function boot(services: Record<string, unknown>, config: Record<string, unknown> = {}) {
  const warnings: string[] = []
  const listeners = new Map<string, (...args: unknown[]) => unknown>()
  const teardown: unknown[] = []
  const ctx = {
    get(name: string) {
      return services[name]
    },
    logger: {
      warn(message: string) {
        warnings.push(String(message))
      },
    },
    on(event: string, listener: (...args: unknown[]) => unknown) {
      listeners.set(event, listener)
      return () => {
        listeners.delete(event)
      }
    },
    effect(effect: () => unknown) {
      const dispose = effect()
      teardown.push(dispose)
      return () => {}
    },
    fiber: { entry: { options: { id: 'status-rotator' } } },
  }
  apply(ctx as never, { enabled: true, typeSpeedMs: 0, gradientEnabled: false, ...config })
  return {
    warnings,
    listeners,
    teardown,
    activate() {
      const session = { id: 'lifecycle-test' }
      listeners.get('session/event')?.(session, { type: 'turn/start', turn: 1 })
      listeners.get('agent/status')?.({ agent: { session }, status: 'running' })
      return session
    },
    unload() {
      const errors: string[] = []
      for (let index = teardown.length - 1; index >= 0; index -= 1) {
        const dispose = teardown[index]
        if (typeof dispose !== 'function') continue
        try {
          dispose()
        } catch (error) {
          errors.push(String(error))
        }
      }
      return errors
    },
  }
}

/** The @deepseek-ai/schemastery-backed config accepts plain objects. */
function statusSeam(overrides: Record<string, unknown> = {}) {
  const calls = { set: [] as unknown[][], views: [] as unknown[] }
  let viewDisposed = 0
  let setDisposed = 0
  const seam = {
    set(key: string, text: string | undefined) {
      calls.set.push([key, text])
      if (typeof text === 'string' && text !== '') return () => { setDisposed += 1 }
      return undefined
    },
    registerView(descriptor: unknown) {
      calls.views.push(descriptor)
      return () => {
        viewDisposed += 1
      }
    },
    viewDisposed: () => viewDisposed,
    setDisposed: () => setDisposed,
    ...overrides,
  }
  return { seam, calls }
}

test('lifecycle: full composition binds every registration to the plugin effect', () => {
  const status = statusSeam()
  const sections: unknown[] = []
  let sectionDisposed = 0
  let commandDisposed = 0
  const runtime = boot({
    tuiStatus: status.seam,
    tuiSettingsSections: {
      register(section: unknown) {
        sections.push(section)
        return () => {
          sectionDisposed += 1
        }
      },
    },
    tuiPluginHost: {
      registerCommand() {
        return () => {
          commandDisposed += 1
        }
      },
    },
    tuiPrompt: { register: () => ({ set() {}, dispose() {} }) },
  })

  assert.equal(status.calls.views.length, 1)
  const descriptor = status.calls.views[0] as { key: string; maxRows: number }
  assert.equal(descriptor.key, 'status-rotator')
  assert.equal(descriptor.maxRows, 1)
  assert.equal(sections.length, 1)
  assert.equal((sections[0] as { ns: string }).ns, 'status-rotator')
  assert.equal((sections[0] as { fields: unknown[] }).fields.length, 15)
  assert.equal(status.seam.setDisposed(), 0)

  runtime.activate()
  const errors = runtime.unload()
  assert.deepEqual(errors, [])
  assert.equal(status.seam.viewDisposed(), 1, 'rich view disposer must run on unload')
  assert.equal(sectionDisposed, 1, 'settings section disposer must run on unload')
  assert.equal(commandDisposed, 1, 'mediated command disposer must run on unload')
})

test('lifecycle: a host with no seams boots as a documented no-op', () => {
  const runtime = boot({})
  assert.ok(runtime.warnings.some(line => line.includes('host.missing-tuiStatus')), runtime.warnings.join(' || '))
  assert.ok(runtime.warnings.some(line => line.includes('host.no-status-seam')), runtime.warnings.join(' || '))
  assert.ok(runtime.warnings.some(line => line.includes('host.missing-commands')), runtime.warnings.join(' || '))
  runtime.activate()
  const errors = runtime.unload()
  assert.deepEqual(errors, [])
})

test('lifecycle: plain fallback updates on rotation and clears on unload', async () => {
  const { seam, calls } = statusSeam({ registerView: undefined })
  const status = { set: seam.set }
  const commands: unknown[] = []
  const runtime = boot({
    tuiStatus: status,
    commands: {
      register(definition: unknown) {
        commands.push(definition)
        return () => {}
      },
    },
  }, { intervalMs: 500 })
  assert.ok(runtime.warnings.some(line => line.includes('host.plain-fallback')), runtime.warnings.join(' || '))
  assert.equal(commands.length, 1)
  runtime.activate()
  await new Promise(resolve => setTimeout(resolve, 700))
  const rendered = calls.set.filter(entry => typeof entry[1] === 'string' && (entry[1] as string).length > 0)
  assert.ok(rendered.length > 0, 'plain status must be written while a turn runs: ' + JSON.stringify(calls.set.slice(0, 3)))
  assert.equal(rendered[0][0], 'status-rotator')

  const statusResult = (commands[0] as { handler: (input: unknown) => { kind: string; text?: string } }).handler('status')
  assert.equal(statusResult.kind, 'success')
  assert.ok(statusResult.text.includes('view=off'), statusResult.text)
  assert.ok(statusResult.text.includes('set=on'), statusResult.text)

  runtime.unload()
  const last = calls.set[calls.set.length - 1]
  assert.equal(last[1], undefined, 'plain contribution must be cleared on unload')
})

test('lifecycle: a rejected mediated command falls back and is still unloaded', () => {
  const { seam } = statusSeam()
  const direct: unknown[] = []
  let directDisposed = 0
  const runtime = boot({
    tuiStatus: seam,
    tuiPluginHost: {
      registerCommand() {
        throw new Error('command "status-rotator" is not bound to a declared contribution id')
      },
    },
    commands: {
      register(definition: unknown) {
        direct.push(definition)
        return () => {
          directDisposed += 1
        }
      },
    },
  })
  assert.equal(direct.length, 1)
  assert.equal((direct[0] as { name: string }).name, 'status-rotator')
  assert.ok(runtime.warnings.some(line => line.includes('command.mediated-failed')), runtime.warnings.join(' || '))
  runtime.unload()
  assert.equal(directDisposed, 1)
})