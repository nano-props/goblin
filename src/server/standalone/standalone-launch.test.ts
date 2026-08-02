import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  bootstrapServer: vi.fn(),
  getLanUrls: vi.fn(),
  isLanAddress: vi.fn(),
  prepareNodePtyDarwinRuntime: vi.fn(),
  qrToString: vi.fn(),
  readOrCreateAccessToken: vi.fn(),
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

vi.mock('#/system/node-pty-runtime.ts', () => ({
  prepareNodePtyDarwinRuntime: mocks.prepareNodePtyDarwinRuntime,
}))

vi.mock('qrcode', () => ({
  default: { toString: mocks.qrToString },
}))

import { launchStandaloneServer } from '#/server/standalone/standalone-launch.ts'

const repoRoot = path.resolve(import.meta.dirname, '../../..')
const runtimeEntryDir = path.join(repoRoot, 'src/server/entrypoints')
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
    await launchStandaloneServer({ repoRoot, runtimeEntryDir }, [
      '--host',
      '127.0.0.1',
      '--port',
      '43210',
      '--data-dir',
      '/tmp/goblin-test-data',
      '--token',
      'generic-explicit-token',
    ])

    expect(process.cwd()).toBe(repoRoot)
    expect(process.env.GOBLIN_SERVER_DATA_DIR).toBe('/tmp/goblin-test-data')
    expect(process.env.GOBLIN_SERVER_ACCESS_TOKEN).toBe('generic-explicit-token')
    expect(process.env.npm_package_version).toBe('0.3.0')
    expect(mocks.prepareNodePtyDarwinRuntime).toHaveBeenCalledWith({
      packageRoot: path.join(repoRoot, 'node_modules/node-pty'),
    })
    expect(mocks.bootstrapServer).toHaveBeenCalledWith({
      ptyWorkerEntry: path.join(runtimeEntryDir, 'pty-worker.ts'),
      gCommandEntry: path.join(runtimeEntryDir, 'g-command.ts'),
    })
    expect(mocks.readOrCreateAccessToken).not.toHaveBeenCalled()
    expect(mocks.qrToString).not.toHaveBeenCalled()
  })

  test('loads QR presentation only when the bound host has LAN URLs', async () => {
    mocks.getLanUrls.mockReturnValue(['http://192.0.2.10:43211'])

    await launchStandaloneServer({ repoRoot, runtimeEntryDir }, [
      '--host',
      '0.0.0.0',
      '--port',
      '43211',
      '--data-dir',
      '/tmp/goblin-lan-test-data',
    ])

    expect(mocks.readOrCreateAccessToken).toHaveBeenCalledWith('/tmp/goblin-lan-test-data')
    expect(mocks.qrToString).toHaveBeenCalledWith('http://192.0.2.10:43211/?accessToken=generic-persisted-token', {
      type: 'terminal',
      small: true,
    })
    expect(console.log).toHaveBeenCalledWith(
      '[embedded-server] LAN URL: http://192.0.2.10:43211/?accessToken=generic-persisted-token',
    )
  })
})
