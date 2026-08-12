import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { BrowserWindowConstructorOptions } from 'electron'
import { defaultSettingsSnapshot } from '#/shared/settings-defaults.ts'
import { CLIENT_EFFECT_INTENT_CHALLENGE_CHANNEL, CLIENT_EFFECT_INTENT_READY_CHANNEL } from '#/shared/ipc-channels.ts'
import { advanceTimersAndFlush, useFakeTimers } from '#/test-utils/timers.ts'
import { waitForMicrotaskCondition } from '#/test-utils/microtasks.ts'

const mocks = vi.hoisted(() => {
  const clientIndexHtml = '<!doctype html><script type="module" src="./assets/index-testhash.js"></script>'
  const state = {
    isPackaged: false,
    clientIndexHtml,
    windows: [] as unknown[],
    windowOptions: [] as BrowserWindowConstructorOptions[],
    ipcMainOn: vi.fn(),
    webContentsOn: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    downloadURL: vi.fn(),
    send: vi.fn(),
    challengeSend: vi.fn(),
    reload: vi.fn(),
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
        ? clientIndexHtml
        : JSON.stringify({ file: 'preload-0.1.0-testhash.cjs' }),
    ),
    mainFrame: {
      processId: 10,
      routingId: 20,
      url: 'http://127.0.0.1:32100/',
      detached: false,
      isDestroyed: () => false,
      send: vi.fn(),
    },
  }
  const BrowserWindow = Object.assign(
    vi.fn(function BrowserWindow(options: BrowserWindowConstructorOptions) {
      const win = {
        webContents: {
          id: 1,
          on: state.webContentsOn,
          setWindowOpenHandler: state.setWindowOpenHandler,
          downloadURL: state.downloadURL,
          send: state.send,
          reload: state.reload,
          isDestroyed: () => false,
          once: vi.fn(),
          get mainFrame() {
            return state.mainFrame
          },
          // Mirror Electron's per-window session shape so the
          // cookie-bootstrap call in `createPrimaryWindow` can plant
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
    on: mocks.ipcMainOn,
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

vi.mock('#/main/settings-server-client.ts', () => ({
  getSettingsSnapshot: mocks.getSettingsSnapshot,
}))

vi.mock('#/main/external-url.ts', () => ({
  openHttpExternal: mocks.openHttpExternal,
}))

vi.mock('#/main/embedded-server-lifecycle.ts', () => ({
  getEmbeddedServerRuntime: mocks.getEmbeddedServerRuntime,
}))

const originalWebDevUrl = process.env.GOBLIN_WEB_DEV_URL

describe('primary window navigation boundaries', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    delete process.env.GOBLIN_WEB_DEV_URL
    mocks.isPackaged = false
    mocks.windows.length = 0
    mocks.windowOptions.length = 0
    mocks.ipcMainOn.mockReset()
    mocks.readFileSync.mockReset()
    mocks.readFileSync.mockImplementation((filePath: string) =>
      filePath.endsWith('/dist/web/index.html')
        ? mocks.clientIndexHtml
        : JSON.stringify({ file: 'preload-0.1.0-testhash.cjs' }),
    )
    mocks.getSettingsSnapshot.mockResolvedValue(defaultSettingsSnapshot())
    mocks.loadWindowState.mockReturnValue(Promise.resolve({ windowBounds: null }))
    mocks.cookieSetMock.mockReset()
    mocks.cookieSetMock.mockResolvedValue(undefined)
    mocks.downloadURL.mockReset()
    mocks.loadURL.mockReset()
    mocks.loadURL.mockResolvedValue(undefined)
    mocks.send.mockReset()
    mocks.challengeSend.mockReset()
    mocks.mainFrame.processId = 10
    mocks.mainFrame.routingId = 20
    mocks.mainFrame.url = 'http://127.0.0.1:32100/'
    mocks.mainFrame.detached = false
    mocks.mainFrame.send.mockReset()
    mocks.mainFrame.send.mockImplementation((channel: string, ...args: unknown[]) => {
      if (channel === CLIENT_EFFECT_INTENT_CHALLENGE_CHANNEL) mocks.challengeSend(channel, ...args)
      else mocks.send(channel, ...args)
    })
    mocks.reload.mockReset()
    mocks.getEmbeddedServerRuntime.mockReset()
    mocks.getEmbeddedServerRuntime.mockReturnValue({
      url: 'http://127.0.0.1:32100/',
      accessToken: 'secret',
    })
  })

  afterEach(() => {
    if (originalWebDevUrl === undefined) delete process.env.GOBLIN_WEB_DEV_URL
    else process.env.GOBLIN_WEB_DEV_URL = originalWebDevUrl
  })

  test('prevents client navigation away from the packaged app page', async () => {
    const { getOrCreatePrimaryWindow } = await import('#/main/window.ts')
    await getOrCreatePrimaryWindow()

    const willNavigate = mocks.webContentsOn.mock.calls.find(([eventName]) => eventName === 'will-navigate')?.[1]
    expect(willNavigate).toBeTypeOf('function')

    const event = { preventDefault: vi.fn() }
    willNavigate(event, 'https://example.com/')

    expect(event.preventDefault).toHaveBeenCalled()
  })

  test('denies new windows and opens web links externally', async () => {
    const { getOrCreatePrimaryWindow } = await import('#/main/window.ts')
    await getOrCreatePrimaryWindow()

    const handler = mocks.setWindowOpenHandler.mock.calls[0]?.[0]
    expect(handler).toBeTypeOf('function')

    expect(handler({ url: 'https://example.com/' })).toEqual({ action: 'deny' })
    expect(mocks.openHttpExternal).toHaveBeenCalledWith('https://example.com/')
    expect(handler({ url: 'file:///tmp/other.html' })).toEqual({ action: 'deny' })
  })

  test('downloads trusted workspace file URLs in the Electron session without opening a window', async () => {
    const { getOrCreatePrimaryWindow } = await import('#/main/window.ts')
    await getOrCreatePrimaryWindow()

    const handler = mocks.setWindowOpenHandler.mock.calls[0]?.[0]
    expect(handler).toBeTypeOf('function')
    const downloadUrl = 'http://127.0.0.1:32100/api/workspace/download-file?kind=workspace-root&path=README.md'

    expect(handler({ url: downloadUrl })).toEqual({ action: 'deny' })
    expect(mocks.downloadURL).toHaveBeenCalledOnce()
    expect(mocks.downloadURL).toHaveBeenCalledWith(downloadUrl)
    expect(mocks.openHttpExternal).not.toHaveBeenCalled()
  })

  test('coalesces concurrent primary window creation', async () => {
    const { getOrCreatePrimaryWindow } = await import('#/main/window.ts')
    let resolveSettings: (settings: { windowBounds: null }) => void = () => {}
    mocks.loadWindowState.mockImplementationOnce(
      () =>
        new Promise<{ windowBounds: null }>((resolve) => {
          resolveSettings = resolve
        }),
    )

    const first = getOrCreatePrimaryWindow()
    const second = getOrCreatePrimaryWindow()
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
    // without throwing out of `getOrCreatePrimaryWindow()`.
    mocks.loadURL.mockRejectedValueOnce(new Error('load failed'))
    const { getOrCreatePrimaryWindow, sendPrimaryWindowEffectIntent } = await import('#/main/window.ts')

    const first = await getOrCreatePrimaryWindow()
    const second = await getOrCreatePrimaryWindow()

    expect(first).toBe(second)
    expect(mocks.BrowserWindow).toHaveBeenCalledTimes(1)
    await expect(sendPrimaryWindowEffectIntent({ type: 'open-workspace-requested' })).rejects.toThrow('load failed')
    expect(mocks.send).not.toHaveBeenCalled()
  })

  test('delivers a window-creating intent to the exact initial document once it is ready', async () => {
    const cookie = Promise.withResolvers<void>()
    mocks.cookieSetMock.mockImplementationOnce(async () => await cookie.promise)
    const { getOrCreatePrimaryWindow, sendPrimaryWindowEffectIntent } = await import('#/main/window.ts')

    const creation = getOrCreatePrimaryWindow()
    await vi.waitFor(() => expect(mocks.BrowserWindow).toHaveBeenCalledOnce())
    const delivery = sendPrimaryWindowEffectIntent({ type: 'open-workspace-requested' })
    await Promise.resolve()

    expect(mocks.send).not.toHaveBeenCalled()
    cookie.resolve()
    await creation
    expect(mocks.send).not.toHaveBeenCalled()
    emitIntentReady()
    await delivery

    expect(mocks.send).toHaveBeenCalledWith('goblin:client-effect-intent', {
      type: 'open-workspace-requested',
    })
  })

  test('fails fast when an existing document is not ready', async () => {
    const { getOrCreatePrimaryWindow, sendPrimaryWindowEffectIntent } = await import('#/main/window.ts')
    await getOrCreatePrimaryWindow()

    await expect(sendPrimaryWindowEffectIntent({ type: 'open-workspace-requested' })).rejects.toThrow(
      'Primary window renderer is not ready',
    )
    expect(mocks.send).not.toHaveBeenCalled()
  })

  test('bounds the readiness wait owned by a window-creating intent', async () => {
    useFakeTimers()
    const { sendPrimaryWindowEffectIntent } = await import('#/main/window.ts')

    const delivery = sendPrimaryWindowEffectIntent({ type: 'open-workspace-requested' })
    const rejection = expect(delivery).rejects.toThrow('was not ready within 30000ms')
    await waitForMicrotaskCondition(() => mocks.loadURL.mock.calls.length === 1)
    await advanceTimersAndFlush(30_000)

    await rejection
    expect(mocks.send).not.toHaveBeenCalled()
  })

  test('ignores an untrusted document readiness handshake', async () => {
    const { getOrCreatePrimaryWindow, sendPrimaryWindowEffectIntent } = await import('#/main/window.ts')
    await getOrCreatePrimaryWindow()
    const delivery = sendPrimaryWindowEffectIntent({ type: 'open-workspace-requested' })

    emitIntentReady('https://example.com/')
    await Promise.resolve()
    expect(mocks.send).not.toHaveBeenCalled()

    emitIntentReady()
    await delivery
    expect(mocks.send).toHaveBeenCalledOnce()
  })

  test('rejects an intent when its renderer generation is superseded during reload', async () => {
    const { getOrCreatePrimaryWindow, reloadPrimaryWindow, sendPrimaryWindowEffectIntent } =
      await import('#/main/window.ts')
    await getOrCreatePrimaryWindow()
    const didStartNavigation = mocks.webContentsOn.mock.calls.find(
      ([eventName]) => eventName === 'did-start-navigation',
    )?.[1]
    expect(didStartNavigation).toBeTypeOf('function')

    expect(reloadPrimaryWindow()).toBe(true)
    expect(mocks.reload).toHaveBeenCalledOnce()
    didStartNavigation({ isMainFrame: true, isSameDocument: false })
    const staleDelivery = sendPrimaryWindowEffectIntent({ type: 'open-workspace-requested' })
    await Promise.resolve()
    expect(mocks.send).not.toHaveBeenCalled()

    expect(reloadPrimaryWindow()).toBe(true)
    didStartNavigation({ isMainFrame: true, isSameDocument: false })
    await expect(staleDelivery).rejects.toThrow('superseded')
    expect(mocks.send).not.toHaveBeenCalled()

    emitIntentReady()
    await sendPrimaryWindowEffectIntent({ type: 'open-settings-requested', page: 'general' })
    expect(mocks.send).toHaveBeenCalledOnce()
    expect(mocks.send).toHaveBeenCalledWith('goblin:client-effect-intent', {
      type: 'open-settings-requested',
      page: 'general',
    })
  })

  test('does not let a stale document readiness response settle the reloaded document', async () => {
    const { getOrCreatePrimaryWindow, reloadPrimaryWindow, sendPrimaryWindowEffectIntent } =
      await import('#/main/window.ts')
    await getOrCreatePrimaryWindow()
    emitIntentReady()
    const didStartNavigation = mocks.webContentsOn.mock.calls.find(
      ([eventName]) => eventName === 'did-start-navigation',
    )?.[1]
    const didStopLoading = mocks.webContentsOn.mock.calls.find(([eventName]) => eventName === 'did-stop-loading')?.[1]

    expect(reloadPrimaryWindow()).toBe(true)
    didStartNavigation({ isMainFrame: true, isSameDocument: false })
    mocks.mainFrame.routingId = 21
    didStopLoading()
    const delivery = sendPrimaryWindowEffectIntent({ type: 'open-workspace-requested' })

    emitIntentReady(undefined, { generation: 1, routingId: 20 })
    await Promise.resolve()
    expect(mocks.send).not.toHaveBeenCalled()

    emitIntentReady(undefined, { generation: 2, routingId: 21 })
    await delivery
    expect(mocks.send).toHaveBeenCalledOnce()
  })

  test('fails the current document when its preload throws', async () => {
    const { getOrCreatePrimaryWindow, sendPrimaryWindowEffectIntent } = await import('#/main/window.ts')
    await getOrCreatePrimaryWindow()
    const preloadError = mocks.webContentsOn.mock.calls.find(([eventName]) => eventName === 'preload-error')?.[1]

    preloadError({}, '/app/src/preload/preload.cjs', new Error('preload boom'))

    await expect(sendPrimaryWindowEffectIntent({ type: 'open-workspace-requested' })).rejects.toThrow(
      'preload failed: preload boom',
    )
    expect(mocks.send).not.toHaveBeenCalled()
  })

  test('fails directly when the active document cannot receive the readiness challenge', async () => {
    mocks.mainFrame.send.mockImplementationOnce(() => {
      throw new Error('frame detached')
    })
    const { getOrCreatePrimaryWindow, sendPrimaryWindowEffectIntent } = await import('#/main/window.ts')
    await getOrCreatePrimaryWindow()
    const delivery = sendPrimaryWindowEffectIntent({ type: 'open-workspace-requested' })
    const didStopLoading = mocks.webContentsOn.mock.calls.find(([eventName]) => eventName === 'did-stop-loading')?.[1]

    didStopLoading()

    await expect(delivery).rejects.toThrow('frame detached')
  })

  test('re-establishes readiness for the active document after navigation is cancelled without a successor', async () => {
    const { getOrCreatePrimaryWindow, reloadPrimaryWindow, sendPrimaryWindowEffectIntent } =
      await import('#/main/window.ts')
    await getOrCreatePrimaryWindow()
    emitIntentReady()
    const didFailLoad = mocks.webContentsOn.mock.calls.find(([eventName]) => eventName === 'did-fail-load')?.[1]
    const didStopLoading = mocks.webContentsOn.mock.calls.find(([eventName]) => eventName === 'did-stop-loading')?.[1]

    expect(reloadPrimaryWindow()).toBe(true)
    const delivery = sendPrimaryWindowEffectIntent({ type: 'open-workspace-requested' })
    didFailLoad({}, -3, 'ERR_ABORTED', 'http://127.0.0.1:32100/', true)
    didStopLoading()
    emitIntentReady(undefined, { generation: 2, routingId: 20 })

    await delivery
    expect(mocks.send).toHaveBeenCalledOnce()
  })

  test('does not fail a successor generation when an earlier navigation reports cancellation late', async () => {
    const { getOrCreatePrimaryWindow, reloadPrimaryWindow, sendPrimaryWindowEffectIntent } =
      await import('#/main/window.ts')
    await getOrCreatePrimaryWindow()
    emitIntentReady()
    const didFailLoad = mocks.webContentsOn.mock.calls.find(([eventName]) => eventName === 'did-fail-load')?.[1]
    const didStartNavigation = mocks.webContentsOn.mock.calls.find(
      ([eventName]) => eventName === 'did-start-navigation',
    )?.[1]

    expect(reloadPrimaryWindow()).toBe(true)
    didStartNavigation({ isMainFrame: true, isSameDocument: false })
    didStartNavigation({ isMainFrame: true, isSameDocument: false })
    mocks.mainFrame.routingId = 21
    const didStopLoading = mocks.webContentsOn.mock.calls.find(([eventName]) => eventName === 'did-stop-loading')?.[1]
    didStopLoading()
    const delivery = sendPrimaryWindowEffectIntent({ type: 'open-settings-requested', page: 'general' })
    didFailLoad({}, -3, 'ERR_ABORTED', 'http://127.0.0.1:32100/', true)
    emitIntentReady(undefined, { generation: 3, routingId: 21 })

    await delivery
    expect(mocks.send).toHaveBeenCalledOnce()
  })

  test('does not let the initial load result settle a newer reload generation', async () => {
    const initialLoad = Promise.withResolvers<void>()
    mocks.loadURL.mockImplementationOnce(async () => await initialLoad.promise)
    const { getOrCreatePrimaryWindow, reloadPrimaryWindow, sendPrimaryWindowEffectIntent } =
      await import('#/main/window.ts')

    const creation = getOrCreatePrimaryWindow()
    await vi.waitFor(() => expect(mocks.loadURL).toHaveBeenCalledOnce())
    const didStartNavigation = mocks.webContentsOn.mock.calls.find(
      ([eventName]) => eventName === 'did-start-navigation',
    )?.[1]
    expect(didStartNavigation).toBeTypeOf('function')

    expect(reloadPrimaryWindow()).toBe(true)
    didStartNavigation({ isMainFrame: true, isSameDocument: false })
    initialLoad.reject(new Error('initial navigation cancelled'))
    await creation

    const delivery = sendPrimaryWindowEffectIntent({ type: 'open-workspace-requested' })
    await Promise.resolve()
    expect(mocks.send).not.toHaveBeenCalled()
    emitIntentReady()
    await delivery

    expect(mocks.send).toHaveBeenCalledOnce()
  })

  test('does not transfer a window-creating intent to a reload generation', async () => {
    const initialLoad = Promise.withResolvers<void>()
    mocks.loadURL.mockImplementationOnce(async () => await initialLoad.promise)
    const { reloadPrimaryWindow, sendPrimaryWindowEffectIntent } = await import('#/main/window.ts')

    const delivery = sendPrimaryWindowEffectIntent({ type: 'open-workspace-requested' })
    await vi.waitFor(() => expect(mocks.loadURL).toHaveBeenCalledOnce())
    const didStartNavigation = mocks.webContentsOn.mock.calls.find(
      ([eventName]) => eventName === 'did-start-navigation',
    )?.[1]
    expect(didStartNavigation).toBeTypeOf('function')

    expect(reloadPrimaryWindow()).toBe(true)
    didStartNavigation({ isMainFrame: true, isSameDocument: false })
    initialLoad.reject(new Error('initial navigation cancelled'))

    await expect(delivery).rejects.toThrow('generation 1 was superseded')
    expect(mocks.send).not.toHaveBeenCalled()
  })

  test('invalidates a ready document when its renderer exits', async () => {
    const { getOrCreatePrimaryWindow, sendPrimaryWindowEffectIntent } = await import('#/main/window.ts')
    await getOrCreatePrimaryWindow()
    emitIntentReady()
    const renderProcessGone = mocks.webContentsOn.mock.calls.find(
      ([eventName]) => eventName === 'render-process-gone',
    )?.[1]
    expect(renderProcessGone).toBeTypeOf('function')

    renderProcessGone({}, { reason: 'crashed' })

    await expect(sendPrimaryWindowEffectIntent({ type: 'open-workspace-requested' })).rejects.toThrow(
      'renderer exited: crashed',
    )
    expect(mocks.send).not.toHaveBeenCalled()
  })

  test('fails directly when Electron rejects delivery to a ready document', async () => {
    mocks.send.mockImplementationOnce(() => {
      throw new Error('renderer unavailable')
    })
    const { getOrCreatePrimaryWindow, sendPrimaryWindowEffectIntent } = await import('#/main/window.ts')
    await getOrCreatePrimaryWindow()
    emitIntentReady()

    await expect(sendPrimaryWindowEffectIntent({ type: 'open-workspace-requested' })).rejects.toThrow(
      'renderer unavailable',
    )
  })

  test('keeps the ready document authoritative when reload fails before navigation starts', async () => {
    mocks.reload.mockImplementationOnce(() => {
      throw new Error('reload unavailable')
    })
    const { getOrCreatePrimaryWindow, reloadPrimaryWindow, sendPrimaryWindowEffectIntent } =
      await import('#/main/window.ts')
    await getOrCreatePrimaryWindow()
    emitIntentReady()

    expect(() => reloadPrimaryWindow()).toThrow('reload unavailable')
    await sendPrimaryWindowEffectIntent({ type: 'open-workspace-requested' })

    expect(mocks.send).toHaveBeenCalledOnce()
  })

  test('loads the configured client dev server URL in development', async () => {
    process.env.GOBLIN_WEB_DEV_URL = 'http://127.0.0.1:5173/'
    const { getOrCreatePrimaryWindow } = await import('#/main/window.ts')

    await getOrCreatePrimaryWindow()

    expect(mocks.loadURL).toHaveBeenCalledWith('http://127.0.0.1:5173/?theme=light&colorTheme=macos')
  })

  test('adds a client build cache key to the embedded server URL', async () => {
    mocks.isPackaged = true
    const { getOrCreatePrimaryWindow } = await import('#/main/window.ts')

    await getOrCreatePrimaryWindow()

    const loadedUrl = new URL(mocks.loadURL.mock.calls[0]?.[0])
    const expectedBuild = createHash('sha256').update(mocks.clientIndexHtml).digest('hex').slice(0, 12)
    expect(loadedUrl.origin).toBe('http://127.0.0.1:32100')
    expect(loadedUrl.searchParams.get('appBuild')).toBe(expectedBuild)
    expect(loadedUrl.searchParams.get('theme')).toBe('light')
    expect(loadedUrl.searchParams.get('colorTheme')).toBe('macos')
    expect(mocks.readFileSync).toHaveBeenCalledWith('/app/dist/web/index.html')
  })

  test('passes the concrete Vite dev URL when planting the host-scoped auth cookie', async () => {
    // Keep the concrete URL; the cookie remains host-scoped with `Path=/`.
    process.env.GOBLIN_WEB_DEV_URL = 'http://127.0.0.1:5173/'
    const { getOrCreatePrimaryWindow } = await import('#/main/window.ts')

    await getOrCreatePrimaryWindow()

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

  test('passes the concrete embedded-server URL when planting the production auth cookie', async () => {
    // Keep the concrete URL; the cookie remains host-scoped with `Path=/`.
    mocks.isPackaged = true
    const { getOrCreatePrimaryWindow } = await import('#/main/window.ts')

    await getOrCreatePrimaryWindow()

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
    const { getOrCreatePrimaryWindow } = await import('#/main/window.ts')

    await getOrCreatePrimaryWindow()

    expect(mocks.windowOptions[0]?.webPreferences?.preload).toBe('/app/src/preload/preload.cjs')
  })

  test('uses the hashed preload artifact from the packaged manifest', async () => {
    mocks.isPackaged = true
    const { getOrCreatePrimaryWindow } = await import('#/main/window.ts')

    await getOrCreatePrimaryWindow()

    expect(mocks.readFileSync).toHaveBeenCalledWith('/app/dist/preload/manifest.json', 'utf8')
    expect(mocks.windowOptions[0]?.webPreferences?.preload).toBe('/app/dist/preload/preload-0.1.0-testhash.cjs')
  })

  test('fails window creation when no client base URL is available', async () => {
    mocks.getEmbeddedServerRuntime.mockReturnValue(null)
    const { getOrCreatePrimaryWindow } = await import('#/main/window.ts')

    await expect(getOrCreatePrimaryWindow()).rejects.toThrow('Client base URL is unavailable')
  })

  test('configures chrome to match the current platform', async () => {
    const { applyPrimaryWindowTitleBarTheme, getOrCreatePrimaryWindow } = await import('#/main/window.ts')

    await getOrCreatePrimaryWindow()

    if (process.platform === 'darwin') {
      expect(mocks.windowOptions[0]).toMatchObject({
        titleBarStyle: 'hiddenInset',
        titleBarOverlay: undefined,
        autoHideMenuBar: false,
      })

      applyPrimaryWindowTitleBarTheme('dark')
      expect(mocks.setTitleBarOverlay).not.toHaveBeenCalled()
      return
    }

    expect(mocks.windowOptions[0]).toMatchObject({
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#ffffff',
        symbolColor: '#000000',
        height: 40,
      },
      autoHideMenuBar: true,
    })

    applyPrimaryWindowTitleBarTheme('dark')

    expect(mocks.setTitleBarOverlay).toHaveBeenCalledWith({
      color: '#1c1c1e',
      symbolColor: '#ffffff',
      height: 40,
    })
  })

  test('opens a fresh window at the 1100x720 default when no bounds are saved', async () => {
    const { getOrCreatePrimaryWindow } = await import('#/main/window.ts')

    await getOrCreatePrimaryWindow()

    expect(mocks.windowOptions[0]).toMatchObject({ width: 1100, height: 720 })
  })

  test('resetPrimaryWindow recenters the window on its current display at default size', async () => {
    const { getOrCreatePrimaryWindow, resetPrimaryWindow } = await import('#/main/window.ts')
    await getOrCreatePrimaryWindow()

    resetPrimaryWindow()

    // workArea is 1440x900 in the mock; 1100x720 centered → x=170, y=90.
    expect(mocks.setBounds).toHaveBeenCalledWith({ x: 170, y: 90, width: 1100, height: 720 }, true)
  })

  test('resetPrimaryWindow unwinds maximize/minimize inline and centers at default size', async () => {
    mocks.isMaximized.mockReturnValueOnce(true)
    mocks.isMinimized.mockReturnValueOnce(true)

    const { getOrCreatePrimaryWindow, resetPrimaryWindow } = await import('#/main/window.ts')
    await getOrCreatePrimaryWindow()

    resetPrimaryWindow()

    expect(mocks.unmaximize).toHaveBeenCalled()
    expect(mocks.setFullScreen).not.toHaveBeenCalled()
    expect(mocks.setBounds).toHaveBeenCalledWith({ x: 170, y: 90, width: 1100, height: 720 }, true)
  })

  test('resetPrimaryWindow defers the resize until macOS leaves fullscreen', async () => {
    mocks.isFullScreen.mockReturnValueOnce(true)

    const { getOrCreatePrimaryWindow, resetPrimaryWindow } = await import('#/main/window.ts')
    await getOrCreatePrimaryWindow()

    resetPrimaryWindow()

    expect(mocks.setFullScreen).toHaveBeenCalledWith(false)
    // Resize is held until the transition completes — firing setBounds
    // mid-animation would be dropped on macOS.
    expect(mocks.setBounds).not.toHaveBeenCalled()
    const onceCall = mocks.windowOnce.mock.calls.find(([event]) => event === 'leave-full-screen')
    expect(onceCall).toBeDefined()

    onceCall![1]()
    expect(mocks.setBounds).toHaveBeenCalledWith({ x: 170, y: 90, width: 1100, height: 720 }, true)
  })

  test('resetPrimaryWindow is a no-op when no primary window exists', async () => {
    const { resetPrimaryWindow } = await import('#/main/window.ts')

    resetPrimaryWindow()

    expect(mocks.setBounds).not.toHaveBeenCalled()
  })
})

function emitIntentReady(
  url = 'http://127.0.0.1:32100/',
  options: { generation?: number; processId?: number; routingId?: number } = {},
): void {
  const didStopLoading = mocks.webContentsOn.mock.calls.find(([eventName]) => eventName === 'did-stop-loading')?.[1]
  if (options.generation === undefined) didStopLoading?.()
  const generation = options.generation ?? mocks.challengeSend.mock.calls.at(-1)?.[1]
  const handler = mocks.ipcMainOn.mock.calls.find(([channel]) => channel === CLIENT_EFFECT_INTENT_READY_CHANNEL)?.[1]
  const win = mocks.windows[0] as { webContents: { id: number } } | undefined
  if (!handler || !win) throw new Error('expected primary window intent readiness handler')
  handler(
    {
      sender: win.webContents,
      senderFrame: {
        url,
        processId: options.processId ?? mocks.mainFrame.processId,
        routingId: options.routingId ?? mocks.mainFrame.routingId,
      },
    },
    generation,
  )
}
