import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { RpcEvent } from '#/shared/rpc.ts'
import { setRendererBridgeForTests } from '#/web/renderer-bridge.ts'

function installBridge(calls: Array<{ path: string; input?: unknown }>, result = new Promise(() => {})): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      goblin: {
        homeDir: '/Users/test',
        invokeRpc: ({ path, input }: { path: string; input?: unknown }) => {
          calls.push({ path, input })
          return result
        },
        abortRpc: (requestId: string) => {
          calls.push({ path: 'goblin:rpc-abort', input: { requestId } })
          return Promise.resolve(false)
        },
        onEvent: () => () => {},
        pathForFile: () => '',
      },
      location: {
        href: 'http://127.0.0.1:32100/',
        origin: 'http://127.0.0.1:32100',
        search: '',
      },
    },
  })
}

describe('native bridge', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    setRendererBridgeForTests(null)
  })

  test('aborts native RPC requests over Electron IPC', async () => {
    const calls: Array<{ path: string; input?: unknown }> = []
    installBridge(calls)
    const { invokeNativeRpcPath } = await import('#/web/native-bridge.ts')
    const ctrl = new AbortController()
    const promise = invokeNativeRpcPath(
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
    expect(calls).toContainEqual({ path: 'goblin:rpc-abort', input: { requestId: expect.any(String) } })
  })

  test('subscribes to typed native events through the renderer bridge', async () => {
    const off = vi.fn()
    const onEvent = vi.fn((cb: (event: RpcEvent) => void) => {
      cb({ type: 'menu-action', action: 'open-repo' })
      cb({ type: 'terminal-bell-click', repoRoot: '/tmp/repo' })
      return off
    })
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        goblin: {
          homeDir: '/Users/test',
          invokeRpc: vi.fn(),
          abortRpc: vi.fn(async () => false),
          onEvent,
          pathForFile: () => '',
        },
        location: {
          href: 'http://127.0.0.1:32100/',
          origin: 'http://127.0.0.1:32100',
          search: '',
        },
      },
    })

    const { onNativeEventType } = await import('#/web/native-bridge.ts')
    const cb = vi.fn()
    const unsubscribe = onNativeEventType('menu-action', cb)

    expect(cb).toHaveBeenCalledWith({ type: 'menu-action', action: 'open-repo' })
    expect(cb).not.toHaveBeenCalledWith({ type: 'terminal-bell-click', repoRoot: '/tmp/repo' })
    unsubscribe()
    expect(off).toHaveBeenCalled()
  })
})
