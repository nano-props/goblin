import { beforeEach, describe, expect, test, vi } from 'vitest'
import { BrowserWindow } from 'electron'
import { createMainWindow } from '#/main/window.ts'
import { openHttpExternal } from '#/main/external-url.ts'

const webContentsOn = vi.fn()
const setWindowOpenHandler = vi.fn()
const windowOn = vi.fn()
const loadURL = vi.fn()

vi.mock('electron', () => ({
  app: {
    getAppPath: () => '/app',
    getPath: () => '/home/user',
  },
  BrowserWindow: vi.fn(function BrowserWindow() {
    return {
      webContents: {
        id: 1,
        on: webContentsOn,
        setWindowOpenHandler,
        isDestroyed: () => false,
        once: vi.fn(),
      },
      isDestroyed: () => false,
      isMinimized: () => false,
      isMaximized: () => false,
      isFullScreen: () => false,
      getNormalBounds: () => ({ x: 0, y: 0, width: 1200, height: 760 }),
      loadURL,
      on: windowOn,
    }
  }),
  screen: {
    getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }),
  },
}))

vi.mock('#/main/settings.ts', () => ({
  loadSettings: vi.fn(() => ({ windowBounds: null })),
  setWindowBounds: vi.fn(),
}))

vi.mock('#/main/theme.ts', () => ({
  getTheme: () => ({ resolved: 'light', colorTheme: 'goblin' }),
}))

vi.mock('#/main/terminal.ts', () => ({
  closeAllTerminalSessions: vi.fn(),
}))

vi.mock('#/main/external-url.ts', () => ({
  openHttpExternal: vi.fn(() => Promise.resolve(true)),
}))

describe('main window navigation boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('prevents renderer navigation away from the packaged app page', async () => {
    await createMainWindow()

    const willNavigate = webContentsOn.mock.calls.find(([eventName]) => eventName === 'will-navigate')?.[1]
    expect(willNavigate).toBeTypeOf('function')

    const event = { preventDefault: vi.fn() }
    willNavigate(event, 'https://example.com/')

    expect(event.preventDefault).toHaveBeenCalled()
  })

  test('denies new windows and opens web links externally', async () => {
    await createMainWindow()

    const handler = setWindowOpenHandler.mock.calls[0]?.[0]
    expect(handler).toBeTypeOf('function')

    expect(handler({ url: 'https://example.com/' })).toEqual({ action: 'deny' })
    expect(openHttpExternal).toHaveBeenCalledWith('https://example.com/')
    expect(handler({ url: 'file:///tmp/other.html' })).toEqual({ action: 'deny' })
  })
})
