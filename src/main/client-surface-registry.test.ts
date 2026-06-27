import { beforeEach, describe, expect, test, vi } from 'vitest'
import { HOST_IPC_EVENT_CHANNEL } from '#/shared/ipc-channels.ts'

const mocks = vi.hoisted(() => ({
  getFocusedWindow: vi.fn(() => null),
}))
let nextWebContentsId = 1

vi.mock('electron', () => ({
  BrowserWindow: {
    getFocusedWindow: mocks.getFocusedWindow,
  },
}))

function makeWindow() {
  const webContents = { id: nextWebContentsId++, isDestroyed: () => false, send: vi.fn() }
  return {
    isDestroyed: () => false,
    once: vi.fn(),
    close: vi.fn(),
    webContents,
  } as any
}

describe('client surface registry', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    nextWebContentsId = 1
  })

  test('tracks the primary window surface and resolves the focused registered window', async () => {
    const registry = await import('#/main/client-surface-registry.ts')
    const primary = makeWindow()

    registry.registerClientWindowSurface(primary, { windowKey: 'main' })

    expect(registry.getPrimaryWindow()).toBe(primary)
    expect(registry.isRegisteredClientSurfaceId(primary.webContents.id)).toBe(true)
    expect(registry.registeredClientSurfaceByWebContentsId(primary.webContents.id)).toEqual({
      windowKey: 'main',
      capabilities: {
        ipcBroadcast: true,
        themeSync: true,
      },
    })

    mocks.getFocusedWindow.mockReturnValue(primary)
    expect(registry.getFocusedRegisteredWindow()).toBe(primary)
    expect(registry.focusedRegisteredSurface()).toEqual({
      windowKey: 'main',
      capabilities: {
        ipcBroadcast: true,
        themeSync: true,
      },
      webContentsId: primary.webContents.id,
      window: primary,
    })
  })

  test('broadcasts to matching surfaces by capability', async () => {
    const registry = await import('#/main/client-surface-registry.ts')
    const primary = makeWindow()

    registry.registerClientWindowSurface(primary, { windowKey: 'main', capabilities: { ipcBroadcast: true } })
    registry.broadcastToSurfaceCapability('ipcBroadcast', HOST_IPC_EVENT_CHANNEL, [{ type: 'settings-write-error' }])

    expect(primary.webContents.send).toHaveBeenCalledWith(HOST_IPC_EVENT_CHANNEL, { type: 'settings-write-error' })
  })

  test('filters surfaces by capability', async () => {
    const registry = await import('#/main/client-surface-registry.ts')
    const primary = makeWindow()

    registry.registerClientWindowSurface(primary, { windowKey: 'main', capabilities: { themeSync: true } })

    expect(registry.allRegisteredSurfacesWithCapability('themeSync')).toEqual([
      {
        windowKey: 'main',
        capabilities: {
          ipcBroadcast: true,
          themeSync: true,
        },
        webContentsId: primary.webContents.id,
        window: primary,
      },
    ])
  })
})
