import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  bootstrapServer: vi.fn(),
  getLanUrls: vi.fn(),
  isLanAddress: vi.fn(),
  dispose: vi.fn(),
  createGoblinCommandLauncher: vi.fn(),
  qrToString: vi.fn(),
  readOrCreateAccessToken: vi.fn(),
  fileExists: vi.fn(() => false),
}))

vi.mock('#/server/bootstrap.ts', () => ({
  bootstrapServer: mocks.bootstrapServer,
}))

vi.mock('#/shared/access-token-file.ts', () => ({
  readOrCreateAccessToken: mocks.readOrCreateAccessToken,
}))

vi.mock('#/shared/lan-addresses.ts', () => ({
  getLanUrls: mocks.getLanUrls,
  isLanAddress: mocks.isLanAddress,
}))

vi.mock('#/server/terminal/g-command.ts', () => ({ createGoblinCommandLauncher: mocks.createGoblinCommandLauncher }))
vi.mock('node:fs', () => ({ existsSync: mocks.fileExists }))

vi.mock('qrcode', () => ({
  default: { toString: mocks.qrToString },
}))

import { launchStandaloneServer } from '#/server/standalone/standalone-launch.ts'

const layout = { command: ['/app/goblin'], webRoot: '/app/web', version: '0.0.0-test' }
const originalCwd = process.cwd()
const environmentKeys = [
  'GOBLIN_SERVER_HOST',
  'GOBLIN_SERVER_PORT',
  'GOBLIN_SERVER_DATA_DIR',
  'GOBLIN_SERVER_ACCESS_TOKEN',
  'npm_package_version',
] as const
let previousEnvironment: Partial<Record<(typeof environmentKeys)[number], string>>

describe('standalone server launch boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    previousEnvironment = {}
    for (const key of environmentKeys) {
      const value = process.env[key]
      if (value !== undefined) previousEnvironment[key] = value
      delete process.env[key]
    }
    mocks.bootstrapServer.mockImplementation(async () => ({
      hostname: process.env.GOBLIN_SERVER_HOST ?? '127.0.0.1',
      port: Number(process.env.GOBLIN_SERVER_PORT ?? 32100),
      stop: vi.fn(async () => undefined),
    }))
    mocks.getLanUrls.mockReturnValue([])
    mocks.isLanAddress.mockReturnValue(false)
    mocks.qrToString.mockResolvedValue('generic-qr-code')
    mocks.readOrCreateAccessToken.mockResolvedValue('generic-persisted-token')
    mocks.fileExists.mockReturnValue(false)
    mocks.createGoblinCommandLauncher.mockReturnValue({ binDir: '/tmp/example-bin', dispose: mocks.dispose })
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    for (const key of environmentKeys) {
      const value = previousEnvironment[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    vi.restoreAllMocks()
  })

  test('projects CLI configuration into the shared worker-backed server bootstrap', async () => {
    const server = await launchStandaloneServer(layout, [
      '--host',
      '127.0.0.1',
      '--port',
      '43210',
      '--data-dir',
      '/tmp/goblin-test-data',
      '--token',
      'generic-explicit-token',
    ])

    expect(process.env.GOBLIN_SERVER_DATA_DIR).toBe('/tmp/goblin-test-data')
    expect(process.env.GOBLIN_SERVER_ACCESS_TOKEN).toBe('generic-explicit-token')
    expect(mocks.bootstrapServer).toHaveBeenCalledWith({
      workerCommand: ['/app/goblin', '--pty-worker'],
      gCommandBinDir: '/tmp/example-bin',
      webRoot: '/app/web',
      version: '0.0.0-test',
    })
    await server.stop()
    expect(mocks.dispose).toHaveBeenCalledOnce()
    expect(mocks.readOrCreateAccessToken).not.toHaveBeenCalled()
    expect(mocks.qrToString).not.toHaveBeenCalled()
    expect(mocks.fileExists).toHaveBeenCalledWith('/app/web/index.html')
    expect(console.warn).toHaveBeenCalledWith('[server] web assets missing; run `bun run build:web` for the web UI')
  })

  test('loads QR presentation only when the bound host has LAN URLs', async () => {
    mocks.getLanUrls.mockReturnValue(['http://192.0.2.10:43211'])

    const server = await launchStandaloneServer(layout, [
      '--host',
      '0.0.0.0',
      '--port',
      '43211',
      '--data-dir',
      '/tmp/goblin-lan-test-data',
    ])

    await server.stop()
    expect(mocks.readOrCreateAccessToken).toHaveBeenCalledWith('/tmp/goblin-lan-test-data')
    expect(mocks.qrToString).toHaveBeenCalledWith('http://192.0.2.10:43211/?accessToken=generic-persisted-token', {
      type: 'terminal',
      small: true,
    })
    expect(console.log).toHaveBeenCalledWith(
      '[server] LAN URL: http://192.0.2.10:43211/?accessToken=generic-persisted-token',
    )
  })

  test('does not report missing web assets when the complete web build exists', async () => {
    mocks.fileExists.mockReturnValue(true)

    const server = await launchStandaloneServer(layout, ['--host', '127.0.0.1', '--token', 'generic-explicit-token'])

    await server.stop()
    expect(mocks.fileExists).toHaveBeenNthCalledWith(1, '/app/web/index.html')
    expect(mocks.fileExists).toHaveBeenNthCalledWith(2, '/app/web/boot.js')
    expect(console.warn).not.toHaveBeenCalledWith('[server] web assets missing; run `bun run build:web` for the web UI')
  })
  test('removes the launcher when bootstrap fails', async () => {
    mocks.bootstrapServer.mockRejectedValueOnce(new Error('bind failed'))
    await expect(launchStandaloneServer(layout, ['--token', 'example-token'])).rejects.toThrow('bind failed')
    expect(mocks.dispose).toHaveBeenCalledOnce()
  })
})
