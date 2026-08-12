import { beforeEach, describe, expect, test, vi } from 'vitest'
import { GET_ACCESS_TOKEN_PROJECTION_CHANNEL, ROTATE_ACCESS_TOKEN_CHANNEL } from '#/shared/ipc-channels.ts'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown) => Promise<unknown>>(),
  readOrCreateAccessToken: vi.fn(),
  rotateAccessTokenFile: vi.fn(),
  isTrustedIpcEvent: vi.fn(() => true),
  getPath: vi.fn(() => '/tmp/goblin-user-data'),
  runtime: { url: 'http://127.0.0.1:32100', accessToken: 'current-token' } as {
    url: string
    accessToken: string
  } | null,
}))

vi.mock('electron', () => ({
  app: { getPath: mocks.getPath },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown) => Promise<unknown>) => {
      mocks.handlers.set(channel, handler)
    }),
  },
}))

vi.mock('#/shared/access-token-file.ts', () => ({
  readOrCreateAccessToken: mocks.readOrCreateAccessToken,
  rotateAccessTokenFile: mocks.rotateAccessTokenFile,
}))

vi.mock('#/main/embedded-server-lifecycle.ts', () => ({
  getEmbeddedServerRuntime: () => mocks.runtime,
}))

vi.mock('#/main/ipc/trusted-webcontents.ts', () => ({
  isTrustedIpcEvent: mocks.isTrustedIpcEvent,
}))

describe('access token rotation IPC', () => {
  beforeEach(async () => {
    mocks.handlers.clear()
    mocks.readOrCreateAccessToken.mockReset()
    mocks.readOrCreateAccessToken.mockResolvedValue('current-token')
    mocks.rotateAccessTokenFile.mockReset()
    mocks.rotateAccessTokenFile.mockResolvedValue('next-start-token')
    mocks.isTrustedIpcEvent.mockReturnValue(true)
    mocks.runtime = { url: 'http://127.0.0.1:32100', accessToken: 'current-token' }
    vi.resetModules()
    const { wireAccessTokenIpc } = await import('#/main/access-token-ipc.ts')
    wireAccessTokenIpc()
  })

  test('stages the next-start token without owning the running server lifecycle', async () => {
    await expect(mocks.handlers.get(ROTATE_ACCESS_TOKEN_CHANNEL)?.({ sender: 'trusted' })).resolves.toEqual({
      accessToken: 'next-start-token',
      activation: 'after-restart',
    })
    expect(mocks.rotateAccessTokenFile).toHaveBeenCalledWith('/tmp/goblin-user-data')
  })

  test('reports the committed next-start token when the running server disappears during rotation', async () => {
    const rotation = Promise.withResolvers<string>()
    mocks.rotateAccessTokenFile.mockReturnValueOnce(rotation.promise)

    const result = mocks.handlers.get(ROTATE_ACCESS_TOKEN_CHANNEL)?.({ sender: 'trusted' })
    mocks.runtime = null
    rotation.resolve('next-start-token')

    await expect(result).resolves.toEqual({
      accessToken: 'next-start-token',
      activation: 'after-restart',
    })
  })

  test('hydrates the persisted token activation relative to the running server', async () => {
    mocks.readOrCreateAccessToken.mockResolvedValueOnce('next-start-token')

    await expect(mocks.handlers.get(GET_ACCESS_TOKEN_PROJECTION_CHANNEL)?.({ sender: 'trusted' })).resolves.toEqual({
      accessToken: 'next-start-token',
      activation: 'after-restart',
    })
  })

  test('reports the persisted token as current after restart activates it', async () => {
    await expect(mocks.handlers.get(GET_ACCESS_TOKEN_PROJECTION_CHANNEL)?.({ sender: 'trusted' })).resolves.toEqual({
      accessToken: 'current-token',
      activation: 'current',
    })
  })

  test('serializes projection reads after an in-flight rotation write', async () => {
    const rotation = Promise.withResolvers<string>()
    mocks.rotateAccessTokenFile.mockReturnValueOnce(rotation.promise)
    mocks.readOrCreateAccessToken.mockResolvedValueOnce('next-start-token')

    const rotate = mocks.handlers.get(ROTATE_ACCESS_TOKEN_CHANNEL)?.({ sender: 'trusted' })
    const read = mocks.handlers.get(GET_ACCESS_TOKEN_PROJECTION_CHANNEL)?.({ sender: 'trusted' })
    expect(mocks.readOrCreateAccessToken).not.toHaveBeenCalled()

    rotation.resolve('next-start-token')
    await expect(rotate).resolves.toEqual({ accessToken: 'next-start-token', activation: 'after-restart' })
    await expect(read).resolves.toEqual({ accessToken: 'next-start-token', activation: 'after-restart' })
  })

  test('rejects an untrusted rotation request before changing the token file', async () => {
    mocks.isTrustedIpcEvent.mockReturnValueOnce(false)

    await expect(mocks.handlers.get(ROTATE_ACCESS_TOKEN_CHANNEL)?.({ sender: 'untrusted' })).rejects.toThrow(
      'Untrusted IPC sender',
    )
    expect(mocks.rotateAccessTokenFile).not.toHaveBeenCalled()
  })
})
