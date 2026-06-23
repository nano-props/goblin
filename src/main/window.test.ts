import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { defaultSettingsSnapshot } from '#/shared/settings-defaults.ts'

const mocks = vi.hoisted(() => {
  const rendererIndexHtml = '<!doctype html><script type="module" src="./assets/index-testhash.js"></script>'
  const state = {
    isPackaged: false,
    rendererIndexHtml,
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
    cookieSetMock: vi.fn(),
    getEmbeddedServerRuntime: vi.fn<() => { url: string; accessToken: string } | null>(() => ({
      url: 'http://127.0.0.1:32100/',
      accessToken: 'secret',
    })),
    readFileSync: vi.fn((filePath: string) =>
      filePath.endsWith('/dist/web/index.html')
        ? rendererIndexHtml
        : JSON.stringify({ file: 'preload-0.1.0-testhash.cjs' }),
    ),
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
          // Mirror Electron's per-window session shape so the
          // cookie-bootstrap call in `createMainWindow` can plant
          // the auth cookie on `webContents.session.cookies`. The
          // mock records every `set` call so the window test can
          // verify the dev/prod URL distinction.
          session: { cookies: { set: state.cookieSetMock } },
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
    getVersion: () => '0.1.0',
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
    mocks.readFileSync.mockImplementation((filePath: string) =>
      filePath.endsWith('/dist/web/index.html')
        ? mocks.rendererIndexHtml
        : JSON.stringify({ file: 'preload-0.1.0-testhash.cjs' }),
    )
    mocks.getSettingsSnapshot.mockResolvedValue(defaultSettingsSnapshot())
    mocks.loadWindowState.mockReturnValue(Promise.resolve({ windowBounds: null }))
    mocks.cookieSetMock.mockReset()
    mocks.cookieSetMock.mockResolvedValue(undefined)
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
    // The log call that surfaces this load failure used to be asserted
    // via `vi.spyOn(console, 'warn')` when the production code logged
    // through `console`. After migrating to pino, the call goes through
    // `nodeLogger` which is re-evaluated every time `vi.resetModules()`
    // runs in `beforeEach`, so a spy set on the test's top-level import
    // would no longer point at the same instance the dynamic import
    // uses. The side-effect assertions below still cover the behavior:
    // the window is preserved (singleton), BrowserWindow is not called
    // a second time (no recreation), and the load failure is handled
    // without throwing out of `getOrCreateMainWindow()`.
    mocks.loadURL.mockRejectedValueOnce(new Error('load failed'))
    const { getOrCreateMainWindow } = await import('#/main/window.ts')

    const first = await getOrCreateMainWindow()
    const second = await getOrCreateMainWindow()

    expect(first).toBe(second)
    expect(mocks.BrowserWindow).toHaveBeenCalledTimes(1)
  })

  test('loads the configured renderer dev server URL in development', async () => {
    process.env.GOBLIN_WEB_DEV_URL = 'http://127.0.0.1:5173/'
    const { getOrCreateMainWindow } = await import('#/main/window.ts')

    await getOrCreateMainWindow()

    expect(mocks.loadURL).toHaveBeenCalledWith('http://127.0.0.1:5173/?theme=light&colorTheme=macos')
  })

  test('adds a renderer build cache key to the embedded server URL', async () => {
    mocks.isPackaged = true
    const { getOrCreateMainWindow } = await import('#/main/window.ts')

    await getOrCreateMainWindow()

    const loadedUrl = new URL(mocks.loadURL.mock.calls[0]?.[0])
    const expectedBuild = createHash('sha256').update(mocks.rendererIndexHtml).digest('hex').slice(0, 12)
    expect(loadedUrl.origin).toBe('http://127.0.0.1:32100')
    expect(loadedUrl.searchParams.get('appBuild')).toBe(expectedBuild)
    expect(loadedUrl.searchParams.get('theme')).toBe('light')
    expect(loadedUrl.searchParams.get('colorTheme')).toBe('macos')
    expect(mocks.readFileSync).toHaveBeenCalledWith('/app/dist/web/index.html')
  })

  test('plants the auth cookie scoped to the Vite dev origin (port 5173)', async () => {
    // Regression: the cookie bootstrap used to strip the port
    // when computing the cookie URL, which silently defaulted
    // the cookie to port 80. In dev the renderer loads from Vite
    // (5173), so the cookie must be scoped to that origin —
    // otherwise the very first whoami probe fails and the token
    // gate reappears on every fresh dev run.
    process.env.GOBLIN_WEB_DEV_URL = 'http://127.0.0.1:5173/'
    const { getOrCreateMainWindow } = await import('#/main/window.ts')

    await getOrCreateMainWindow()

    expect(mocks.cookieSetMock).toHaveBeenCalledTimes(1)
    expect(mocks.cookieSetMock.mock.calls[0]?.[0]).toMatchObject({
      url: 'http://127.0.0.1:5173/',
      name: 'goblin_access_token',
      value: 'secret',
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    })
  })

  test('plants the auth cookie scoped to the embedded server origin (port 32100) in production', async () => {
    // Mirror of the dev test above for the packaged build path:
    // the cookie must carry the embedded server's port, not the
    // default port 80.
    mocks.isPackaged = true
    const { getOrCreateMainWindow } = await import('#/main/window.ts')

    await getOrCreateMainWindow()

    expect(mocks.cookieSetMock).toHaveBeenCalledTimes(1)
    expect(mocks.cookieSetMock.mock.calls[0]?.[0]).toMatchObject({
      url: 'http://127.0.0.1:32100/',
      name: 'goblin_access_token',
      value: 'secret',
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    })
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

  test('uses the renderer dev server origin in window URL during development', async () => {
    // The bootstrap (access token, server URL, home dir, platform)
    // is ferried from the main process to the preload via IPC; the
    // `webDevUrl` env override just changes which URL the renderer
    // window is pointed at (Vite vs the embedded server's static
    // file route). The dev-URL override flows through
    // `createRendererEntryUrl`; the bootstrap-IPC behavior is
    // covered by the IPC handler tests.
    process.env.GOBLIN_WEB_DEV_URL = 'http://127.0.0.1:5173/'
    const { getOrCreateMainWindow } = await import('#/main/window.ts')

    await getOrCreateMainWindow()

    expect(mocks.windowOptions[0]?.webPreferences?.preload).toBeTruthy()
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
