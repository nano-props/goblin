import { beforeEach, describe, expect, test, vi } from 'vitest'
import { defaultSettingsSnapshot } from '#/shared/settings-defaults.ts'

const mocks = vi.hoisted(() => {
  const state = {
    isPackaged: false,
    windows: [] as any[],
    windowOptions: [] as any[],
    webContentsOn: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    windowOn: vi.fn(),
    windowOnce: vi.fn(),
    loadURL: vi.fn(),
    openHttpExternal: vi.fn(() => Promise.resolve(true)),
    getSettingsSnapshot: vi.fn(),
    loadWindowState: vi.fn(() => Promise.resolve({ windowBounds: null })),
    setTitleBarOverlay: vi.fn(),
    setBounds: vi.fn(),
    setFullScreen: vi.fn(),
    unmaximize: vi.fn(),
    isFullScreen: vi.fn(() => false),
    isMaximized: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    getEmbeddedServerRuntime: vi.fn<() => { url: string; secret: string; clientId: string } | null>(() => ({
      url: 'http://127.0.0.1:32100/',
      secret: 'secret',
      clientId: 'client_sharedterminal',
    })),
    readFileSync: vi.fn(() => JSON.stringify({ file: 'preload-0.1.0-testhash.cjs' })),
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
        isMinimized: state.isMinimized,
        isMaximized: state.isMaximized,
        isFullScreen: state.isFullScreen,
        restore: vi.fn(),
        show: vi.fn(),
        focus: vi.fn(),
        setTitleBarOverlay: state.setTitleBarOverlay,
        getNormalBounds: () => ({ x: 0, y: 0, width: 900, height: 600 }),
        getBounds: () => ({ x: 0, y: 0, width: 900, height: 600 }),
        setBounds: state.setBounds,
        setFullScreen: state.setFullScreen,
        unmaximize: state.unmaximize,
        loadURL: state.loadURL,
        on: state.windowOn,
        once: state.windowOnce,
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
    get isPackaged() {
      return mocks.isPackaged
    },
    getAppPath: () => '/app',
    getPath: () => '/home/user',
    whenReady: () => Promise.resolve(),
    show: vi.fn(),
    focus: vi.fn(),
  },
  BrowserWindow: mocks.BrowserWindow,
  ipcMain: {
    on: vi.fn(),
    handle: vi.fn(),
    removeHandler: vi.fn(),
    removeAllListeners: vi.fn(),
  },
  screen: {
    getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }),
  },
}))

vi.mock('node:fs', () => ({
  readFileSync: mocks.readFileSync,
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
    mocks.isPackaged = false
    mocks.windows.length = 0
    mocks.windowOptions.length = 0
    mocks.readFileSync.mockReset()
    mocks.readFileSync.mockReturnValue(JSON.stringify({ file: 'preload-0.1.0-testhash.cjs' }))
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

  test('uses the source preload path while unpackaged', async () => {
    const { getOrCreateMainWindow } = await import('#/main/window.ts')

    await getOrCreateMainWindow()

    expect(mocks.windowOptions[0]?.webPreferences?.preload).toBe('/app/src/preload/preload.cjs')
  })

  test('uses the hashed preload artifact from the packaged manifest', async () => {
    mocks.isPackaged = true
    const { getOrCreateMainWindow } = await import('#/main/window.ts')

    await getOrCreateMainWindow()

    expect(mocks.readFileSync).toHaveBeenCalledWith('/app/dist/preload/manifest.json', 'utf8')
    expect(mocks.windowOptions[0]?.webPreferences?.preload).toBe('/app/dist/preload/preload-0.1.0-testhash.cjs')
  })

  test('uses the renderer dev server origin in bootstrap server config during development', async () => {
    process.env.GOBLIN_WEB_DEV_URL = 'http://127.0.0.1:5173/'
    const { getOrCreateMainWindow } = await import('#/main/window.ts')

    await getOrCreateMainWindow()

    const payload = await readBootstrapPayload()
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

    const payload = await readBootstrapPayload()
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

  test('opens a fresh window at the 1100x720 default when no bounds are saved', async () => {
    const { getOrCreateMainWindow } = await import('#/main/window.ts')

    await getOrCreateMainWindow()

    expect(mocks.windowOptions[0]).toMatchObject({ width: 1100, height: 720 })
  })

  test('resetMainWindowToDefault recenters the window on its current display at default size', async () => {
    const { getOrCreateMainWindow, resetMainWindowToDefault } = await import('#/main/window.ts')
    await getOrCreateMainWindow()

    resetMainWindowToDefault()

    // workArea is 1440x900 in the mock; 1100x720 centered → x=170, y=90.
    expect(mocks.setBounds).toHaveBeenCalledWith({ x: 170, y: 90, width: 1100, height: 720 }, true)
  })

  test('resetMainWindowToDefault unwinds maximize/minimize inline and centers at default size', async () => {
    mocks.isMaximized.mockReturnValueOnce(true)
    mocks.isMinimized.mockReturnValueOnce(true)

    const { getOrCreateMainWindow, resetMainWindowToDefault } = await import('#/main/window.ts')
    await getOrCreateMainWindow()

    resetMainWindowToDefault()

    expect(mocks.unmaximize).toHaveBeenCalled()
    expect(mocks.setFullScreen).not.toHaveBeenCalled()
    expect(mocks.setBounds).toHaveBeenCalledWith({ x: 170, y: 90, width: 1100, height: 720 }, true)
  })

  test('resetMainWindowToDefault defers the resize until macOS leaves fullscreen', async () => {
    mocks.isFullScreen.mockReturnValueOnce(true)

    const { getOrCreateMainWindow, resetMainWindowToDefault } = await import('#/main/window.ts')
    await getOrCreateMainWindow()

    resetMainWindowToDefault()

    expect(mocks.setFullScreen).toHaveBeenCalledWith(false)
    // Resize is held until the transition completes — firing setBounds
    // mid-animation would be dropped on macOS.
    expect(mocks.setBounds).not.toHaveBeenCalled()
    const onceCall = mocks.windowOnce.mock.calls.find(([event]) => event === 'leave-full-screen')
    expect(onceCall).toBeDefined()

    onceCall![1]()
    expect(mocks.setBounds).toHaveBeenCalledWith({ x: 170, y: 90, width: 1100, height: 720 }, true)
  })

  test('resetMainWindowToDefault is a no-op when no main window exists', async () => {
    const { resetMainWindowToDefault } = await import('#/main/window.ts')

    resetMainWindowToDefault()

    expect(mocks.setBounds).not.toHaveBeenCalled()
  })
})

const BOOTSTRAP_TOKEN_PREFIX = '--goblin-bootstrap-token='
const BOOTSTRAP_CHANNEL = 'goblin:get-bootstrap'

/**
 * Recover the renderer bootstrap payload by replaying the same IPC
 * path the preload uses: extract the token from the additionalArguments
 * injected by `createRendererWindowWebPreferences`, then call the
 * `ipcMain.on(BOOTSTRAP_CHANNEL)` handler the window-shell module
 * registered at import time.
 */
async function readBootstrapPayload(): Promise<Record<string, unknown>> {
  const { ipcMain } = await import('electron')
  const tokenArg = mocks.windowOptions[0]?.webPreferences?.additionalArguments?.find((arg: string) =>
    arg.startsWith(BOOTSTRAP_TOKEN_PREFIX),
  )
  if (!tokenArg) throw new Error(`no ${BOOTSTRAP_TOKEN_PREFIX}* arg found in additionalArguments`)
  const token = tokenArg.slice(BOOTSTRAP_TOKEN_PREFIX.length)
  const handler = vi.mocked(ipcMain.on).mock.calls
    .map(([channel, fn]) => (channel === BOOTSTRAP_CHANNEL ? fn : null))
    .find((fn): fn is (event: { returnValue: unknown }, token: string) => void => fn !== undefined)
  if (!handler) throw new Error(`no handler registered for ${BOOTSTRAP_CHANNEL}`)
  const event = { returnValue: undefined as unknown }
  handler(event, token)
  if (!event.returnValue) throw new Error(`bootstrap token ${token} was not registered`)
  return event.returnValue as Record<string, unknown>
}
