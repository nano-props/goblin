import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const state = {
    windows: [] as any[],
    windowOptions: [] as any[],
    webContentsOn: vi.fn(),
    webContentsSend: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    windowOn: vi.fn(),
    windowOnce: vi.fn(),
    loadURL: vi.fn(),
    setTitleBarOverlay: vi.fn(),
    openHttpExternal: vi.fn(() => Promise.resolve(true)),
    flushWindowLifecycle: vi.fn(() => Promise.resolve({ ok: true, errors: [] })),
    forgetWindowLifecycle: vi.fn(),
  }
  const BrowserWindow = Object.assign(
    vi.fn(function BrowserWindow(options: any) {
      const win = {
        webContents: {
          id: state.windows.length + 1,
          on: state.webContentsOn,
          send: state.webContentsSend,
          setWindowOpenHandler: state.setWindowOpenHandler,
          isDestroyed: () => false,
          isLoading: () => false,
          once: vi.fn(),
        },
        isDestroyed: () => false,
        isVisible: () => true,
        isMinimized: () => false,
        restore: vi.fn(),
        show: vi.fn(),
        focus: vi.fn(),
        setTitleBarOverlay: state.setTitleBarOverlay,
        close: vi.fn(function () {
          const closeHandlers = state.windowOn.mock.calls
            .filter(([event]) => event === 'close')
            .map(([, handler]) => handler)
          const closeEvent = {
            defaultPrevented: false,
            preventDefault() {
              this.defaultPrevented = true
            },
          }
          for (const handler of closeHandlers) handler(closeEvent)
          if (closeEvent.defaultPrevented) return
          const closedListener = state.windowOnce.mock.calls.find(([event]) => event === 'closed')?.[1]
          if (typeof closedListener === 'function') closedListener()
        }),
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
    getAppPath: () => '/app',
    whenReady: () => Promise.resolve(),
  },
  ipcMain: {
    on: vi.fn(),
  },
  BrowserWindow: mocks.BrowserWindow,
}))

vi.mock('#/main/i18n/index.ts', () => ({
  t: vi.fn((key: string) => key),
  getCurrentLang: vi.fn(() => 'en'),
  getDictionary: vi.fn(() => ({ 'settings.title': 'Settings' })),
}))

vi.mock('#/main/theme.ts', () => ({
  getTheme: () => ({ resolved: 'light', colorTheme: 'macos' }),
}))

vi.mock('#/main/window-chrome.ts', () => ({
  macTrafficLightPosition: vi.fn(() => undefined),
  standaloneTitleBarStyle: vi.fn(() => 'hidden'),
  supportsTitleBarOverlay: vi.fn(() => true),
  titleBarOverlayForTheme: vi.fn((theme: 'light' | 'dark', _colorTheme: string, height: number) => ({
    color: theme === 'dark' ? '#000000' : '#ffffff',
    symbolColor: theme === 'dark' ? '#ffffff' : '#000000',
    height,
  })),
}))

vi.mock('#/main/external-url.ts', () => ({
  openHttpExternal: mocks.openHttpExternal,
}))

vi.mock('#/main/window-lifecycle.ts', () => ({
  flushWindowLifecycle: mocks.flushWindowLifecycle,
  forgetWindowLifecycle: mocks.forgetWindowLifecycle,
}))

describe('settings window', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    delete process.env.GOBLIN_RENDERER_DEV_URL
    mocks.windows.length = 0
    mocks.windowOptions.length = 0
  })

  test('loads the standalone settings entry', async () => {
    const { openSettingsWindow } = await import('#/main/settings-window.ts')

    await openSettingsWindow('about')

    expect(mocks.loadURL).toHaveBeenCalledWith('file:///app/dist/renderer/settings.html?theme=light&colorTheme=macos#about')
  })

  test('focuses the existing settings window and pushes page changes', async () => {
    const { openSettingsWindow } = await import('#/main/settings-window.ts')

    const first = await openSettingsWindow('general')
    const second = await openSettingsWindow('shortcuts')

    expect(second).toBe(first)
    expect(mocks.BrowserWindow).toHaveBeenCalledTimes(1)
    expect(first.focus).toHaveBeenCalled()
    expect(mocks.webContentsSend).toHaveBeenCalledWith('goblin:window-page-set:settings', 'shortcuts')
  })

  test('tracks open state and can close the settings window', async () => {
    const { openSettingsWindow, isSettingsWindowOpen, closeSettingsWindow } = await import('#/main/settings-window.ts')

    await openSettingsWindow('general')
    expect(isSettingsWindowOpen()).toBe(true)

    await closeSettingsWindow()

    expect(mocks.windows[0]?.close).toHaveBeenCalled()
    expect(mocks.flushWindowLifecycle).toHaveBeenCalled()
  })

  test('uses themed overlay chrome and can update it after creation', async () => {
    const { applySettingsWindowChromeTheme, openSettingsWindow } = await import('#/main/settings-window.ts')

    await openSettingsWindow('general')

    expect(mocks.windowOptions[0]).toMatchObject({
      titleBarStyle: 'hidden',
      autoHideMenuBar: false,
      titleBarOverlay: {
        color: '#ffffff',
        symbolColor: '#000000',
        height: 40,
      },
    })

    applySettingsWindowChromeTheme('dark')

    expect(mocks.setTitleBarOverlay).toHaveBeenCalledWith({
      color: '#000000',
      symbolColor: '#ffffff',
      height: 40,
    })
  })
})
