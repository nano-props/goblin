import { EventEmitter } from 'node:events'
import { createServer } from 'node:net'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mockFetch } from '#/test-utils/fetch-mock.ts'

const mocks = vi.hoisted(() => ({
  appExit: vi.fn(),
  showErrorBox: vi.fn(),
  spawn: vi.fn(),
}))

// The lifecycle runs inside Electron, but these tests exercise its process
// boundary under plain Node. Keep the Electron surface observable and small:
// app exit and the fatal dialog are the product outcomes asserted below.
vi.mock('electron', () => ({
  app: {
    getAppPath: () => process.cwd(),
    isPackaged: false,
    getPath: () => '/tmp',
    exit: mocks.appExit,
  },
  dialog: { showErrorBox: mocks.showErrorBox },
}))

vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))

vi.mock('#/shared/access-token-file.ts', () => ({
  readOrCreateAccessToken: vi.fn(async () => 'test-token'),
}))

const {
  DEFAULT_EMBEDDED_SERVER_PORT,
  getEmbeddedServerRuntime,
  parseServerPort,
  reserveEmbeddedServerPort,
  resolveEmbeddedServerRuntimeRoot,
  startEmbeddedServer,
  stopEmbeddedServer,
} = await import('#/main/embedded-server-lifecycle.ts')

const openServers: Array<ReturnType<typeof createServer>> = []

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('GOBLIN_ENABLE_EMBEDDED_SERVER', '1')
})

afterEach(async () => {
  await stopEmbeddedServer('app-quit')
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  await Promise.all(
    openServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve())
        }),
    ),
  )
})

function createServerChild() {
  const child = new EventEmitter() as EventEmitter & {
    pid: number
    stdout: PassThrough
    stderr: PassThrough
    kill: ReturnType<typeof vi.fn>
    emitExit(code: number | null, signal: NodeJS.Signals | null): void
  }
  let exited = false
  child.pid = 4242
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.emitExit = (code, signal) => {
    if (exited) return
    exited = true
    child.emit('exit', code, signal)
  }
  child.kill = vi.fn((signal: NodeJS.Signals = 'SIGTERM') => {
    queueMicrotask(() => child.emitExit(null, signal))
    return true
  })
  return child
}

async function reserveTestPort(): Promise<number> {
  const server = createServer()
  openServers.push(server)
  return await new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('failed to reserve test port'))
        return
      }
      resolve(address.port)
    })
  })
}

describe('embedded server port selection', () => {
  test('parses configured ports and falls back to the default port for invalid values', () => {
    expect(parseServerPort('32123')).toBe(32123)
    expect(parseServerPort(undefined)).toBe(DEFAULT_EMBEDDED_SERVER_PORT)
    expect(parseServerPort('0')).toBe(DEFAULT_EMBEDDED_SERVER_PORT)
    expect(parseServerPort('abc')).toBe(DEFAULT_EMBEDDED_SERVER_PORT)
  })

  test('prefers the fixed port when it is available', async () => {
    const preferredPort = await reserveEmbeddedServerPort('127.0.0.1', 0)

    await expect(reserveEmbeddedServerPort('127.0.0.1', preferredPort)).resolves.toBe(preferredPort)
  })

  test('falls back to a random port when the fixed port is already occupied', async () => {
    const preferredPort = await reserveTestPort()

    const port = await reserveEmbeddedServerPort('127.0.0.1', preferredPort)

    expect(port).not.toBe(preferredPort)
    expect(port).toBeGreaterThan(0)
  })
})

describe('embedded server process lifecycle', () => {
  test('uses an ASAR-unaware Node runtime for the embedded server process', async () => {
    const child = createServerChild()
    mocks.spawn.mockReturnValue(child)
    mockFetch(() => ({ ok: true }))

    await startEmbeddedServer()

    expect(mocks.spawn).toHaveBeenCalledWith(
      process.execPath,
      [path.join(process.cwd(), 'src/server/entrypoints/main.ts')],
      expect.objectContaining({
        env: expect.objectContaining({
          ELECTRON_RUN_AS_NODE: '1',
          ELECTRON_NO_ASAR: '1',
        }),
      }),
    )
  })

  test('resolves packaged server entries from the ordinary Resources runtime', () => {
    expect(resolveEmbeddedServerRuntimeRoot('/Applications/Goblin.app/Contents/Resources/app.asar', true)).toBe(
      path.join('/Applications/Goblin.app/Contents/Resources', 'dist/server'),
    )
    expect(() => resolveEmbeddedServerRuntimeRoot('/Applications/Goblin.app/Contents/Resources/app', true)).toThrow(
      'Packaged app path must be an ASAR archive',
    )
  })

  test('fails the native host when a ready server exits unexpectedly', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    const child = createServerChild()
    mocks.spawn.mockReturnValue(child)
    mockFetch(() => ({ ok: true }))
    await startEmbeddedServer()

    child.stderr.write('Error: test server failure\n')
    child.emitExit(1, null)

    expect(errorLog).toHaveBeenCalledWith('[server] Error: test server failure')
    expect(getEmbeddedServerRuntime()).toBeNull()
    expect(mocks.showErrorBox).toHaveBeenCalledWith('Goblin server stopped', expect.stringContaining('exit code 1'))
    expect(mocks.showErrorBox).toHaveBeenCalledWith(
      'Goblin server stopped',
      expect.stringContaining('Error: test server failure'),
    )
    expect(mocks.appExit).toHaveBeenCalledWith(1)
  })

  test('does not fail the native host when the server is stopped intentionally', async () => {
    const child = createServerChild()
    mocks.spawn.mockReturnValue(child)
    mockFetch(() => ({ ok: true }))
    await startEmbeddedServer()

    await stopEmbeddedServer('app-quit')

    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    expect(mocks.showErrorBox).not.toHaveBeenCalled()
    expect(mocks.appExit).not.toHaveBeenCalled()
  })

  test('reports startup failure without entering the ready-server fatal boundary', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    const child = createServerChild()
    mocks.spawn.mockReturnValue(child)
    mockFetch(() => ({ ok: false }))
    const starting = startEmbeddedServer()
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(1))

    child.stderr.write('Error: startup failed\n')
    child.emitExit(1, null)

    await expect(starting).rejects.toThrow('Embedded server exited before becoming ready (exit code 1)')
    expect(errorLog).toHaveBeenCalledWith('[server] Error: startup failed')
    expect(mocks.showErrorBox).not.toHaveBeenCalled()
    expect(mocks.appExit).not.toHaveBeenCalled()
  })

  test('fails startup without entering the fatal boundary when the process cannot spawn', async () => {
    const child = createServerChild()
    mocks.spawn.mockReturnValue(child)
    mockFetch(() => ({ ok: false }))
    const starting = startEmbeddedServer()
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(1))

    child.emit('error', new Error('spawn unavailable'))

    await expect(starting).rejects.toThrow('spawn unavailable')
    expect(getEmbeddedServerRuntime()).toBeNull()
    expect(mocks.showErrorBox).not.toHaveBeenCalled()
    expect(mocks.appExit).not.toHaveBeenCalled()
  })

  test('cancels an in-flight start when an intentional stop wins the race', async () => {
    const child = createServerChild()
    mocks.spawn.mockReturnValue(child)
    mockFetch(() => ({ ok: false }))
    const starting = startEmbeddedServer()
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(1))

    await stopEmbeddedServer('app-quit')

    await expect(starting).resolves.toBeNull()
    expect(getEmbeddedServerRuntime()).toBeNull()
    expect(mocks.showErrorBox).not.toHaveBeenCalled()
    expect(mocks.appExit).not.toHaveBeenCalled()
  })
})
