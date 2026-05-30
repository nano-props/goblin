import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const state = {
    windows: [] as any[],
    webContentsOn: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    windowOn: vi.fn(),
    loadURL: vi.fn(),
    openHttpExternal: vi.fn(() => Promise.resolve(true)),
    loadSettings: vi.fn(() => Promise.resolve({ windowBounds: null })),
  }
  const BrowserWindow = Object.assign(
    vi.fn(function BrowserWindow() {
      const win = {
        webContents: {
          id: 1,
          on: state.webContentsOn,
          setWindowOpenHandler: state.setWindowOpenHandler,
          isDestroyed: () => false,
          once: vi.fn(),
        },
        isDestroyed: () => false,
        isVisible: () => true,
        isMinimized: () => false,
        isMaximized: () => false,
        isFullScreen: () => false,
        restore: vi.fn(),
        show: vi.fn(),
        focus: vi.fn(),
        getNormalBounds: () => ({ x: 0, y: 0, width: 1200, height: 760 }),
        loadURL: state.loadURL,
        on: state.windowOn,
      }
      state.windows.push(win)
      return win
    }),
    {
      getAllWindows: () => state.windows,
    },
  )
  return { ...state, BrowserWindow }
})

vi.mock('electron', () => ({
  app: {
    getAppPath: () => '/app',
    getPath: () => '/home/user',
    whenReady: () => Promise.resolve(),
    show: vi.fn(),
    focus: vi.fn(),
  },
  BrowserWindow: mocks.BrowserWindow,
  screen: {
    getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }),
  },
}))

vi.mock('#/main/settings.ts', () => ({
  loadSettings: mocks.loadSettings,
  setWindowBounds: vi.fn(),
}))

vi.mock('#/main/theme.ts', () => ({
  getTheme: () => ({ resolved: 'light', colorTheme: 'macos' }),
}))

vi.mock('#/main/terminal.ts', () => ({
  closeAllTerminalSessions: vi.fn(),
}))

vi.mock('#/main/external-url.ts', () => ({
  openHttpExternal: mocks.openHttpExternal,
}))

describe('main window navigation boundaries', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    delete process.env.GOBLIN_RENDERER_DEV_URL
    mocks.windows.length = 0
    mocks.loadSettings.mockReturnValue(Promise.resolve({ windowBounds: null }))
  })

  test('prevents renderer navigation away from the packaged app page', async () => {
    const { getOrCreateMainWindow } = await import('#/main/window.ts')
    await getOrCreateMainWindow()

    const willNavigate = mocks.webContentsOn.mock.calls.find(([eventName]) => eventName === 'will-navigate')?.[1]
    expect(willNavigate).toBeTypeOf('function')

    const event = { preventDefault: vi.fn() }
    willNavigate(event, 'https://example.com/')

    expect(event.preventDefault).toHaveBeenCalled()
  })

  test('denies new windows and opens web links externally', async () => {
    const { getOrCreateMainWindow } = await import('#/main/window.ts')
    await getOrCreateMainWindow()

    const handler = mocks.setWindowOpenHandler.mock.calls[0]?.[0]
    expect(handler).toBeTypeOf('function')

    expect(handler({ url: 'https://example.com/' })).toEqual({ action: 'deny' })
    expect(mocks.openHttpExternal).toHaveBeenCalledWith('https://example.com/')
    expect(handler({ url: 'file:///tmp/other.html' })).toEqual({ action: 'deny' })
  })

  test('coalesces concurrent main window creation', async () => {
    const { getOrCreateMainWindow } = await import('#/main/window.ts')
    let resolveSettings: (settings: { windowBounds: null }) => void = () => {}
    mocks.loadSettings.mockImplementationOnce(
      () =>
        new Promise<{ windowBounds: null }>((resolve) => {
          resolveSettings = resolve
        }),
    )

    const first = getOrCreateMainWindow()
    const second = getOrCreateMainWindow()
    resolveSettings({ windowBounds: null })
    const [firstWindow, secondWindow] = await Promise.all([first, second])

    expect(firstWindow).toBe(secondWindow)
    expect(mocks.BrowserWindow).toHaveBeenCalledTimes(1)
  })

  test('keeps the window singleton when app URL load fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.loadURL.mockRejectedValueOnce(new Error('load failed'))
    const { getOrCreateMainWindow } = await import('#/main/window.ts')

    const first = await getOrCreateMainWindow()
    const second = await getOrCreateMainWindow()

    expect(first).toBe(second)
    expect(mocks.BrowserWindow).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith('[window] failed to load app URL', expect.any(Error))
    warn.mockRestore()
  })

  test('loads the configured renderer dev server URL in development', async () => {
    process.env.GOBLIN_RENDERER_DEV_URL = 'http://127.0.0.1:5173/'
    const { getOrCreateMainWindow } = await import('#/main/window.ts')

    await getOrCreateMainWindow()

    expect(mocks.loadURL).toHaveBeenCalledWith('http://127.0.0.1:5173/?theme=light&colorTheme=macos')
  })
})
