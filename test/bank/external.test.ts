/**
 * External hot-reload bank loader.
 *
 * The web original reads \`$DSH_HOME/status-rotator/phrases.json\` on every
 * request and keeps the last good document when the file is corrupt. This port
 * polls the dsh-TUI data-directory copy (\`~/.dsh-tui/status-rotator/bank.json\`)
 * from the TUI process, so the same guarantees are pinned here against a real
 * temporary file: missing = off, corrupt = keep last good + expose error,
 * change = reload, delete = fall back to the built-in bank.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import {
  EXTERNAL_BANK_ENV,
  EXTERNAL_BANK_FILE,
  EXTERNAL_BANK_POLL_MS,
  createExternalBank,
  defaultExternalBankDir,
  expandBankPath,
  resolveExternalBankPath,
} from '../../lib/types/bank/external.js'

/** Wait for a predicate to become true (polling), returns false on timeout. */
async function waitFor(predicate, timeoutMs = 8000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return true
    await new Promise((done) => setTimeout(done, 25))
  }
  return false
}

/** Create a temporary plugin data directory and its cleanup. */
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-tui-status-rotator-bank-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

/** Write one JSON file into a directory. */
function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value), 'utf8')
}

/** A handle plus recorded callbacks, with a deterministic clock. */
function makeHandle(dir, overrides = {}) {
  const reloads = []
  const logs = []
  const now = () => 1_700_000_000_000 + reloads.length
  const handle = createExternalBank({
    dir,
    now,
    onReload: (doc) => reloads.push(doc),
    log: (code, message) => logs.push({ code, message }),
    ...overrides,
  })
  return { handle, reloads, logs }
}

/** A minimal valid external bank document. */
function bankDoc(phrase = '外部词库 A…') {
  return {
    packs: [{ id: 'my-pack', phrases: { zh: { thinking: [phrase] } } }],
    enabledPacks: ['my-pack'],
  }
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

test('default bank directory follows the dsh-TUI data-dir convention', () => {
  assert.equal(defaultExternalBankDir({}), join(homedir(), '.dsh-tui', 'status-rotator'))
  assert.ok(defaultExternalBankDir({}).endsWith(join('.dsh-tui', 'status-rotator')))
})

test('bank path precedence: explicit file > env > dir default', () => {
  const dir = join(tmpdir(), 'dsh-bank-dir')
  assert.equal(resolveExternalBankPath({ dir }), join(dir, EXTERNAL_BANK_FILE))
  assert.equal(resolveExternalBankPath({ dir: '/ignored', file: '/explicit/bank.json' }), '/explicit/bank.json')
  assert.equal(
    resolveExternalBankPath({ dir: '/ignored', env: { [EXTERNAL_BANK_ENV]: '/from/env/bank.json' } }),
    '/from/env/bank.json',
  )
  assert.equal(
    resolveExternalBankPath({ dir: '/ignored', file: '/explicit/bank.json', env: { [EXTERNAL_BANK_ENV]: '/from/env/bank.json' } }),
    '/explicit/bank.json',
  )
  assert.equal(resolveExternalBankPath({ dir: '/fallback', env: { [EXTERNAL_BANK_ENV]: '   ' } }), join('/fallback', EXTERNAL_BANK_FILE))
  assert.equal(resolveExternalBankPath({ file: null, dir: '/fallback' }), join('/fallback', EXTERNAL_BANK_FILE))
})

test('bank path expands ~ and resolves relative paths against cwd', () => {
  assert.equal(expandBankPath('~/custom/bank.json'), join(homedir(), 'custom', 'bank.json'))
  assert.equal(resolveExternalBankPath({ file: 'relative/bank.json' }), resolve(process.cwd(), 'relative/bank.json'))
  assert.equal(resolveExternalBankPath({ file: '/absolute/bank.json' }), '/absolute/bank.json')
})

// ---------------------------------------------------------------------------
// Loader behavior
// ---------------------------------------------------------------------------

test('a missing file means "external layer off": no error, no callback', async () => {
  const { dir, cleanup } = tempDir()
  const { handle, reloads, logs } = makeHandle(dir)
  try {
    handle.start()
    assert.deepEqual(reloads, [])
    assert.deepEqual(logs, [])
    const status = handle.status()
    assert.equal(status.ok, true)
    assert.equal(status.loaded, false)
    assert.equal(status.error, null)
    assert.equal(status.reloads, 0)
    assert.equal(status.lastLoadedAt, null)
    assert.equal(status.path, join(dir, EXTERNAL_BANK_FILE))
    assert.equal(handle.current(), null)
  } finally {
    handle.stop()
    cleanup()
  }
})

test('a valid file loads once on start and exposes a normalized document', async () => {
  const { dir, cleanup } = tempDir()
  writeJson(join(dir, EXTERNAL_BANK_FILE), bankDoc())
  const { handle, reloads, logs } = makeHandle(dir)
  try {
    handle.start()
    assert.equal(reloads.length, 1)
    assert.deepEqual(logs, [])
    const doc = handle.current()
    assert.deepEqual(Object.keys(doc), ['packs', 'enabledPacks'])
    assert.equal(doc.packs.length, 1)
    assert.deepEqual(doc.packs[0].phrases.zh.thinking, [{ text: '外部词库 A…', weight: 1 }])
    assert.deepEqual(doc.enabledPacks, ['my-pack'])
    const status = handle.status()
    assert.equal(status.ok, true)
    assert.equal(status.loaded, true)
    assert.equal(status.error, null)
    assert.equal(status.reloads, 1)
    assert.equal(typeof status.lastLoadedAt, 'number')
  } finally {
    handle.stop()
    cleanup()
  }
})

test('start() is idempotent and reloadNow() is a no-op when nothing changed', async () => {
  const { dir, cleanup } = tempDir()
  writeJson(join(dir, EXTERNAL_BANK_FILE), bankDoc())
  const { handle, reloads } = makeHandle(dir)
  try {
    handle.start()
    handle.start()
    handle.reloadNow()
    handle.reloadNow()
    assert.equal(reloads.length, 1)
    assert.equal(handle.status().reloads, 1)
  } finally {
    handle.stop()
    cleanup()
  }
})

test('a corrupt file keeps serving the last good document and exposes the error', async () => {
  const { dir, cleanup } = tempDir()
  const path = join(dir, EXTERNAL_BANK_FILE)
  writeJson(path, bankDoc('good…'))
  const { handle, reloads, logs } = makeHandle(dir)
  try {
    handle.start()
    assert.equal(reloads.length, 1)
    writeFileSync(path, '{ this is not json', 'utf8')
    handle.reloadNow()
    assert.equal(reloads.length, 1, 'corrupt reload must not replace the last good document')
    assert.equal(handle.current().packs[0].phrases.zh.thinking[0].text, 'good…')
    const broken = handle.status()
    assert.equal(broken.loaded, true)
    assert.equal(broken.ok, false)
    assert.match(broken.error, /not valid JSON/)
    assert.ok(logs.some((entry) => entry.code === 'bank.external-parse'))
    // Recovering works without a restart.
    writeJson(path, bankDoc('fixed…'))
    handle.reloadNow()
    assert.equal(reloads.length, 2)
    assert.equal(handle.current().packs[0].phrases.zh.thinking[0].text, 'fixed…')
    assert.equal(handle.status().error, null)
    assert.equal(handle.status().ok, true)
  } finally {
    handle.stop()
    cleanup()
  }
})

test('a well-formed JSON that is not a bank document is rejected explicitly', async () => {
  const { dir, cleanup } = tempDir()
  writeJson(join(dir, EXTERNAL_BANK_FILE), { config: { intervalMs: 1 } })
  const { handle, reloads, logs } = makeHandle(dir)
  try {
    handle.start()
    assert.equal(reloads.length, 0)
    const status = handle.status()
    assert.equal(status.ok, false)
    assert.equal(status.loaded, false)
    assert.match(status.error, /not a usable bank document/)
    assert.ok(logs.some((entry) => entry.code === 'bank.external-invalid'))
    assert.ok(logs.some((entry) => entry.code === 'bank.doc-empty'))
  } finally {
    handle.stop()
    cleanup()
  }
})

test('deleting the file after a load falls back to the built-in bank via onReload({})', async () => {
  const { dir, cleanup } = tempDir()
  const path = join(dir, EXTERNAL_BANK_FILE)
  writeJson(path, bankDoc())
  const { handle, reloads } = makeHandle(dir)
  try {
    handle.start()
    assert.equal(reloads.length, 1)
    unlinkSync(path)
    handle.reloadNow()
    assert.equal(reloads.length, 2)
    assert.deepEqual(reloads[1], {}, 'empty document tells the runtime to drop the external layer')
    assert.equal(handle.current(), null)
    const status = handle.status()
    assert.equal(status.loaded, false)
    assert.equal(status.ok, true)
    assert.equal(status.error, null)
  } finally {
    handle.stop()
    cleanup()
  }
})

test('normalization warnings are logged and invalid entries are dropped from current()', async () => {
  const { dir, cleanup } = tempDir()
  writeJson(join(dir, EXTERNAL_BANK_FILE), {
    packs: [{ id: 'my-pack', phrases: { zh: { today: ['bad key…'], thinking: ['ok…', 'bad\u0000entry'] } } }],
  })
  const { handle, reloads, logs } = makeHandle(dir)
  try {
    handle.start()
    assert.equal(reloads.length, 1)
    assert.ok(logs.some((entry) => entry.code === 'bank.unknown-field'))
    assert.ok(logs.some((entry) => entry.code === 'bank.text-control'))
    assert.deepEqual(handle.current().packs[0].phrases.zh.thinking, [{ text: 'ok…', weight: 1 }])
  } finally {
    handle.stop()
    cleanup()
  }
})

test('only packs / phrases / enabledPacks survive from the file', async () => {
  const { dir, cleanup } = tempDir()
  writeJson(join(dir, EXTERNAL_BANK_FILE), {
    config: { intervalMs: 1 },
    schedule: [],
    phrases: { zh: { thinking: ['core override…'] } },
    packs: [{ id: 'my-pack', phrases: { zh: { running: ['pack…'] } } }],
  })
  const { handle, logs } = makeHandle(dir)
  try {
    handle.start()
    const doc = handle.current()
    assert.deepEqual(Object.keys(doc).sort(), ['packs', 'phrases'])
    assert.equal(doc.phrases.zh.thinking[0].text, 'core override…')
    assert.ok(logs.some((entry) => entry.code === 'bank.unknown-field'))
  } finally {
    handle.stop()
    cleanup()
  }
})

test('an onReload callback that throws never breaks loading', async () => {
  const { dir, cleanup } = tempDir()
  writeJson(join(dir, EXTERNAL_BANK_FILE), bankDoc())
  const logs = []
  const handle = createExternalBank({
    dir,
    onReload: () => {
      throw new Error('boom')
    },
    log: (code, message) => logs.push({ code, message }),
  })
  try {
    assert.doesNotThrow(() => handle.start())
    assert.equal(handle.status().loaded, true)
    assert.ok(logs.some((entry) => entry.code === 'bank.external-callback'))
  } finally {
    handle.stop()
    cleanup()
  }
})

test('env var and explicit file override the data directory', async () => {
  const { dir, cleanup } = tempDir()
  const custom = join(dir, 'custom-bank.json')
  writeJson(custom, bankDoc('from env…'))

  const fromEnv = makeHandle(join(dir, 'unused'), { env: { [EXTERNAL_BANK_ENV]: custom } })
  try {
    fromEnv.handle.start()
    assert.equal(fromEnv.reloads.length, 1)
    assert.equal(fromEnv.handle.status().path, custom)
    assert.equal(fromEnv.handle.current().packs[0].phrases.zh.thinking[0].text, 'from env…')
  } finally {
    fromEnv.handle.stop()
  }

  const explicitDir = join(dir, 'explicit-target')
  mkdirSync(explicitDir, { recursive: true })
  const explicit = makeHandle(join(dir, 'unused'), { file: join(explicitDir, 'bank.json') })
  try {
    explicit.handle.start()
    assert.equal(explicit.reloads.length, 0, 'explicit path does not exist yet')
    writeJson(join(explicitDir, 'bank.json'), bankDoc('from file…'))
    explicit.handle.reloadNow()
    assert.equal(explicit.reloads.length, 1)
    assert.equal(explicit.handle.current().packs[0].phrases.zh.thinking[0].text, 'from file…')
  } finally {
    explicit.handle.stop()
    cleanup()
  }
})

test('a file created after start() is picked up by the watcher', async () => {
  const { dir, cleanup } = tempDir()
  const path = join(dir, EXTERNAL_BANK_FILE)
  const { handle, reloads } = makeHandle(dir)
  try {
    handle.start()
    assert.equal(reloads.length, 0)
    writeJson(path, bankDoc('created later…'))
    assert.ok(await waitFor(() => reloads.length === 1), 'watcher should notice the new file')
    assert.equal(handle.current().packs[0].phrases.zh.thinking[0].text, 'created later…')
    assert.equal(handle.status().loaded, true)
  } finally {
    handle.stop()
    cleanup()
  }
})

test('the 2s watcher picks up changes and stop() detaches it', async () => {
  const { dir, cleanup } = tempDir()
  const path = join(dir, EXTERNAL_BANK_FILE)
  writeJson(path, bankDoc('first…'))
  const { handle, reloads } = makeHandle(dir)
  try {
    handle.start()
    assert.equal(reloads.length, 1)
    writeJson(path, bankDoc('second…'))
    // fs.watchFile polls on a timer; under a fully parallel test run the poll
    // can slip past three intervals on a loaded machine. The assertion is about
    // "eventually detected", not latency, so use a wider window.
    assert.ok(await waitFor(() => reloads.length === 2, EXTERNAL_BANK_POLL_MS * 6 + 2_000), 'watcher should detect the rewrite')
    assert.equal(handle.current().packs[0].phrases.zh.thinking[0].text, 'second…')
    assert.equal(handle.status().reloads, 2)

    handle.stop()
    writeJson(path, bankDoc('third…'))
    await new Promise((done) => setTimeout(done, EXTERNAL_BANK_POLL_MS + 750))
    assert.equal(reloads.length, 2, 'no reload is delivered after stop()')
  } finally {
    handle.stop()
    cleanup()
  }
})

test('status() keeps its last snapshot after stop()', async () => {
  const { dir, cleanup } = tempDir()
  writeJson(join(dir, EXTERNAL_BANK_FILE), bankDoc())
  const { handle } = makeHandle(dir)
  try {
    handle.start()
    handle.stop()
    const status = handle.status()
    assert.equal(status.loaded, true)
    assert.equal(status.ok, true)
    assert.equal(status.reloads, 1)
    handle.stop()
  } finally {
    cleanup()
  }
})