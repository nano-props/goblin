import { beforeEach, describe, expect, test, vi } from 'vitest'
import { IPC_EVENT_CHANNEL } from '#/shared/ipc-channels.ts'

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

describe('window registry', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    nextWebContentsId = 1
  })

  test('tracks the main window surface and resolves the focused registered window', async () => {
    const registry = await import('#/main/window-registry.ts')
    const main = makeWindow()

    registry.registerRendererWindowSurface(main, { windowKey: 'main' })

    expect(registry.getMainWindow()).toBe(main)
    expect(registry.isRegisteredRendererSurfaceId(main.webContents.id)).toBe(true)
    expect(registry.registeredRendererSurfaceByWebContentsId(main.webContents.id)).toEqual({
      windowKey: 'main',
      capabilities: {
        ipcBroadcast: true,
        themeSync: true,
      },
    })

    mocks.getFocusedWindow.mockReturnValue(main)
    expect(registry.getFocusedRegisteredWindow()).toBe(main)
    expect(registry.focusedRegisteredSurface()).toEqual({
      windowKey: 'main',
      capabilities: {
        ipcBroadcast: true,
        themeSync: true,
      },
      webContentsId: main.webContents.id,
      window: main,
    })
  })

  test('broadcasts to matching surfaces by capability', async () => {
    const registry = await import('#/main/window-registry.ts')
    const main = makeWindow()

    registry.registerRendererWindowSurface(main, { windowKey: 'main', capabilities: { ipcBroadcast: true } })
    registry.broadcastToSurfaceCapability('ipcBroadcast', IPC_EVENT_CHANNEL, [{ type: 'settings-write-error' }])

    expect(main.webContents.send).toHaveBeenCalledWith(IPC_EVENT_CHANNEL, { type: 'settings-write-error' })
  })

  test('filters surfaces by capability', async () => {
    const registry = await import('#/main/window-registry.ts')
    const main = makeWindow()

    registry.registerRendererWindowSurface(main, { windowKey: 'main', capabilities: { themeSync: true } })

    expect(registry.allRegisteredSurfacesWithCapability('themeSync')).toEqual([
      {
        windowKey: 'main',
        capabilities: {
          ipcBroadcast: true,
          themeSync: true,
        },
        webContentsId: main.webContents.id,
        window: main,
      },
    ])
  })
})
