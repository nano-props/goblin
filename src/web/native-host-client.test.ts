import { beforeEach, describe, expect, test, vi } from 'vitest'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import { currentNativeBridge } from '#/web/test-utils/current-native-bridge.ts'

function installBridge(calls: Array<{ path: string; input?: unknown }>, result = new Promise(() => {})): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      goblinNative: currentNativeBridge({
        invokeIpc: ({ path, input }: { path: string; input?: unknown }) => {
          calls.push({ path, input })
          return result
        },
        abortIpc: (requestId: string) => {
          calls.push({ path: 'goblin:ipc-abort', input: { requestId } })
          return Promise.resolve(false)
        },
      }),
      location: {
        href: 'http://127.0.0.1:32100/',
        origin: 'http://127.0.0.1:32100',
        search: '',
      },
    },
  })
}

describe('native host client', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    setClientBridgeForTests(null)
  })

  test('aborts native IPC requests', async () => {
    const calls: Array<{ path: string; input?: unknown }> = []
    installBridge(calls)
    const { invokeNativeIpcPath } = await import('#/web/native-host-client.ts')
    const ctrl = new AbortController()
    const promise = invokeNativeIpcPath(
      'settings.setGlobalShortcut',
      { accelerator: 'CommandOrControl+Shift+K' },
      ctrl.signal,
    )

    ctrl.abort()
    await expect(promise).rejects.toThrow('Request aborted')

    expect(calls).toContainEqual({
      path: 'settings.setGlobalShortcut',
      input: { accelerator: 'CommandOrControl+Shift+K' },
    })
    expect(calls).toContainEqual({ path: 'goblin:ipc-abort', input: { requestId: expect.any(String) } })
  })
})
