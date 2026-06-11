import { beforeEach, describe, expect, test, vi } from 'vitest'
import { defaultSettingsSnapshot } from '#/shared/settings-defaults.ts'

const mocks = vi.hoisted(() => {
  const state = {
    windows: [] as any[],
    windowOptions: [] as any[],
    webContentsOn: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    windowOn: vi.fn(),
    loadURL: vi.fn(),
    openHttpExternal: vi.fn(() => Promise.resolve(true)),
    getSettingsSnapshot: vi.fn(),
    loadWindowState: vi.fn(() => Promise.resolve({ windowBounds: null })),
    setTitleBarOverlay: vi.fn(),
    getEmbeddedServerRuntime: vi.fn<() => { url: string; secret: string; clientId: string } | null>(() => ({
      url: 'http://127.0.0.1:32100/',
      secret: 'secret',
      clientId: 'client_sharedterminal',
    })),
  }
  const BrowserWindow = Object.assign(
    vi.fn(function BrowserWindow(options: any) {
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
        setTitleBarOverlay: state.setTitleBarOverlay,
        getNormalBounds: () => ({ x: 0, y: 0, width: 900, height: 600 }),
        loadURL: state.loadURL,
        on: state.windowOn,
      }
      state.windowOptions.push(options)
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

vi.mock('#/main/window-state.ts', () => ({
  loadWindowState: mocks.loadWindowState,
  setWindowBounds: vi.fn(),
}))

vi.mock('#/main/theme.ts', () => ({
  getTheme: () => ({ resolved: 'light', colorTheme: 'macos' }),
}))

vi.mock('#/main/i18n/index.ts', () => ({
  getCurrentLang: () => 'en',
  getDictionary: () => ({}),
}))

vi.mock('#/main/settings-server-client.ts', () => ({
  getSettingsSnapshot: mocks.getSettingsSnapshot,
}))

vi.mock('#/main/external-url.ts', () => ({
  openHttpExternal: mocks.openHttpExternal,
}))

vi.mock('#/main/server-manager.ts', () => ({
  getEmbeddedServerRuntime: mocks.getEmbeddedServerRuntime,
}))

describe('main window navigation boundaries', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    delete process.env.GOBLIN_WEB_DEV_URL
    mocks.windows.length = 0
    mocks.windowOptions.length = 0
    mocks.getSettingsSnapshot.mockResolvedValue(defaultSettingsSnapshot())
    mocks.loadWindowState.mockReturnValue(Promise.resolve({ windowBounds: null }))
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
    mocks.loadWindowState.mockImplementationOnce(
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
    process.env.GOBLIN_WEB_DEV_URL = 'http://127.0.0.1:5173/'
    const { getOrCreateMainWindow } = await import('#/main/window.ts')

    await getOrCreateMainWindow()

    expect(mocks.loadURL).toHaveBeenCalledWith('http://127.0.0.1:5173/?theme=light&colorTheme=macos')
  })

  test('uses the renderer dev server origin in bootstrap server config during development', async () => {
    process.env.GOBLIN_WEB_DEV_URL = 'http://127.0.0.1:5173/'
    const { getOrCreateMainWindow } = await import('#/main/window.ts')

    await getOrCreateMainWindow()

    const bootstrapArg = mocks.windowOptions[0]?.webPreferences?.additionalArguments?.find((arg: string) =>
      arg.startsWith('--goblin-bootstrap='),
    )
    const payload = JSON.parse(Buffer.from(String(bootstrapArg).slice('--goblin-bootstrap='.length), 'base64').toString('utf8'))
    expect(payload.server).toMatchObject({
      url: 'http://127.0.0.1:5173/',
      secret: expect.any(String),
      clientId: expect.any(String),
    })
  })

  test('uses the settings snapshot language preference in renderer bootstrap', async () => {
    mocks.getSettingsSnapshot.mockResolvedValue(defaultSettingsSnapshot({ lang: 'ja' }))
    const { getOrCreateMainWindow } = await import('#/main/window.ts')

    await getOrCreateMainWindow()

    const bootstrapArg = mocks.windowOptions[0]?.webPreferences?.additionalArguments?.find((arg: string) =>
      arg.startsWith('--goblin-bootstrap='),
    )
    const payload = JSON.parse(Buffer.from(String(bootstrapArg).slice('--goblin-bootstrap='.length), 'base64').toString('utf8'))
    expect(payload.i18n).toMatchObject({ pref: 'ja' })
  })

  test('fails window creation when no renderer base URL is available', async () => {
    mocks.getEmbeddedServerRuntime.mockReturnValue(null)
    const { getOrCreateMainWindow } = await import('#/main/window.ts')

    await expect(getOrCreateMainWindow()).rejects.toThrow('Renderer base URL is unavailable')
  })

  test('configures chrome to match the current platform', async () => {
    const { applyMainWindowChromeTheme, getOrCreateMainWindow } = await import('#/main/window.ts')

    await getOrCreateMainWindow()

    if (process.platform === 'darwin') {
      expect(mocks.windowOptions[0]).toMatchObject({
        titleBarStyle: 'hiddenInset',
        titleBarOverlay: undefined,
        autoHideMenuBar: false,
      })

      applyMainWindowChromeTheme('dark')
      expect(mocks.setTitleBarOverlay).not.toHaveBeenCalled()
      return
    }

    expect(mocks.windowOptions[0]).toMatchObject({
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#fbfbfd',
        symbolColor: '#000000',
        height: 40,
      },
      autoHideMenuBar: true,
    })

    applyMainWindowChromeTheme('dark')

    expect(mocks.setTitleBarOverlay).toHaveBeenCalledWith({
      color: '#1c1c1e',
      symbolColor: '#ffffff',
      height: 40,
    })
  })
})
