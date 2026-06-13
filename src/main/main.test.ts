import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { SettingsSnapshot } from '#/shared/api-types.ts'
import { defaultSettingsSnapshot } from '#/shared/settings-defaults.ts'

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, Array<(...args: any[]) => any>>()
  let resolveReady: () => void = () => {}
  let whenReadyPromise = Promise.resolve()
  return {
    handlers,
    appOn: vi.fn((name: string, handler: (...args: any[]) => any) => {
      const next = handlers.get(name) ?? []
      next.push(handler)
      handlers.set(name, next)
    }),
    requestSingleInstanceLock: vi.fn(() => true),
    getAppPath: vi.fn(() => '/app'),
    exit: vi.fn(),
    quit: vi.fn(),
    whenReady: vi.fn(() => whenReadyPromise),
    activateMainWindow: vi.fn(() => Promise.resolve({})),
    assertDictionaryParity: vi.fn(),
    buildAppMenu: vi.fn(),
    flushWindowState: vi.fn(() => Promise.resolve(true)),
    getSettingsSnapshot: vi.fn<() => Promise<SettingsSnapshot>>(),
    setSettingsGlobalShortcutState: vi.fn(async () => true),
    initializeMenuRuntimeState: vi.fn(),
    initTheme: vi.fn(() => Promise.resolve()),
    resolveLang: vi.fn(() => 'en'),
    setCurrentLang: vi.fn(),
    syncGlobalShortcuts: vi.fn(),
    enqueueExternalOpenPath: vi.fn(() => true),
    unregisterAppShortcuts: vi.fn(),
    wireIpc: vi.fn(),
    broadcastRendererEffectIntent: vi.fn(),
    wireShellBridgeIpc: vi.fn(),
    wireTerminalIpc: vi.fn(),
    resetReady() {
      whenReadyPromise = new Promise<void>((resolve) => {
        resolveReady = resolve
      })
    },
    resolveReady() {
      resolveReady()
    },
  }
})

vi.mock('electron', () => ({
  app: {
    focus: vi.fn(),
    getAppPath: mocks.getAppPath,
    getPath: vi.fn(() => '/tmp/goblin'),
    isPackaged: false,
    on: mocks.appOn,
    exit: mocks.exit,
    quit: mocks.quit,
    requestSingleInstanceLock: mocks.requestSingleInstanceLock,
    show: vi.fn(),
    whenReady: mocks.whenReady,
  },
  dialog: {
    showErrorBox: vi.fn(),
  },
  // wireMainProcessIpc() registers the renderer-bootstrap handler via
  // registerBootstrapIpc(); the test never reads from it but the
  // call must not throw, so we expose a no-op ipcMain.
  ipcMain: {
    on: vi.fn(),
    handle: vi.fn(),
    removeHandler: vi.fn(),
    removeAllListeners: vi.fn(),
  },
}))

vi.mock('#/main/window.ts', () => ({
  activateMainWindow: mocks.activateMainWindow,
}))

vi.mock('#/main/theme.ts', () => ({
  initTheme: mocks.initTheme,
}))

vi.mock('#/main/window-state.ts', () => ({
  flushWindowState: mocks.flushWindowState,
}))

vi.mock('#/main/menu.ts', () => ({
  buildAppMenu: mocks.buildAppMenu,
}))

vi.mock('#/main/menu-state.ts', () => ({
  initializeMenuRuntimeState: mocks.initializeMenuRuntimeState,
  applyMenuRuntimeState: vi.fn(),
}))

vi.mock('#/main/recent-repos.ts', () => ({
  syncRecentRepos: vi.fn(),
}))

vi.mock('#/main/i18n/index.ts', () => ({
  assertDictionaryParity: mocks.assertDictionaryParity,
  resolveLang: mocks.resolveLang,
  setCurrentLang: mocks.setCurrentLang,
}))

vi.mock('#/main/ipc', () => ({
  wireIpc: mocks.wireIpc,
}))

vi.mock('#/main/renderer-surface-events.ts', () => ({
  broadcastRendererEffectIntent: mocks.broadcastRendererEffectIntent,
}))

vi.mock('#/main/shell-bridge.ts', () => ({
  wireShellBridgeIpc: mocks.wireShellBridgeIpc,
}))

vi.mock('#/main/terminal.ts', () => ({
  wireTerminalIpc: mocks.wireTerminalIpc,
}))

vi.mock('#/main/settings-server-client.ts', () => ({
  getSettingsSnapshot: mocks.getSettingsSnapshot,
  setSettingsGlobalShortcutState: mocks.setSettingsGlobalShortcutState,
}))

vi.mock('#/main/server-manager.ts', () => ({
  startEmbeddedServer: vi.fn(() => Promise.resolve()),
  stopEmbeddedServer: vi.fn(() => Promise.resolve()),
}))

vi.mock('#/main/shortcuts.ts', () => ({
  syncGlobalShortcuts: mocks.syncGlobalShortcuts,
  unregisterAppShortcuts: mocks.unregisterAppShortcuts,
}))

vi.mock('#/main/external-open.ts', () => ({
  enqueueExternalOpenPath: mocks.enqueueExternalOpenPath,
}))

describe('main process startup lifecycle', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.handlers.clear()
    mocks.resetReady()
    mocks.getSettingsSnapshot.mockResolvedValue(defaultSettingsSnapshot())
  })

  test('flushes settings and shortcut cleanup before exiting', async () => {
    await import('#/main/main.ts')

    const event = { preventDefault: vi.fn() }
    await emit('before-quit', event)
    const secondPassEvent = { preventDefault: vi.fn() }
    await emit('before-quit', secondPassEvent)

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(mocks.broadcastRendererEffectIntent).toHaveBeenCalledWith({ type: 'app-quitting' })
    expect(mocks.flushWindowState).toHaveBeenCalledTimes(1)
    expect(mocks.unregisterAppShortcuts).toHaveBeenCalledTimes(1)
    expect(mocks.exit).toHaveBeenCalledWith(0)
    expect(mocks.quit).not.toHaveBeenCalled()
    expect(secondPassEvent.preventDefault).not.toHaveBeenCalled()
  })

  test('defers second-instance activation until startup initialization finishes', async () => {
    await import('#/main/main.ts')

    await emit('second-instance')
    await Promise.resolve()
    expect(mocks.activateMainWindow).not.toHaveBeenCalled()

    mocks.resolveReady()
    await vi.waitFor(() => {
      expect(mocks.buildAppMenu).toHaveBeenCalled()
      expect(mocks.activateMainWindow).toHaveBeenCalled()
    })
  })

  test('does not activate or create a window if quit starts before initialization finishes', async () => {
    await import('#/main/main.ts')

    await emit('second-instance')
    await emit('before-quit', { preventDefault: vi.fn() })
    mocks.resolveReady()

    await vi.waitFor(() => {
      expect(mocks.buildAppMenu).toHaveBeenCalled()
      expect(mocks.exit).toHaveBeenCalledWith(0)
    })

    expect(mocks.activateMainWindow).not.toHaveBeenCalled()
    expect(mocks.handlers.get('activate')).toBeUndefined()
  })

  test('initializes the current language from the server-owned preference when available', async () => {
    mocks.getSettingsSnapshot.mockResolvedValueOnce(defaultSettingsSnapshot({ lang: 'ja' }))

    await import('#/main/main.ts')
    mocks.resolveReady()

    await vi.waitFor(() => {
      expect(mocks.buildAppMenu).toHaveBeenCalled()
    })

    expect(mocks.resolveLang).toHaveBeenCalledWith('ja')
    expect(mocks.setCurrentLang).toHaveBeenCalledWith('en')
  })

  test('initializes global shortcuts from the embedded server settings snapshot when available', async () => {
    const snapshot = defaultSettingsSnapshot()
    mocks.getSettingsSnapshot.mockResolvedValueOnce({
      ...snapshot,
      globalShortcutDisabled: true,
      globalShortcut: 'Alt+K',
      session: {
        ...snapshot.session,
        detailCollapsed: false,
      },
    })

    await import('#/main/main.ts')
    mocks.resolveReady()

    await vi.waitFor(() => {
      expect(mocks.syncGlobalShortcuts).toHaveBeenCalledWith(true, 'Alt+K')
    })
  })

  test('queues open-file paths and defers activation until startup initialization finishes', async () => {
    await import('#/main/main.ts')

    const event = { preventDefault: vi.fn() }
    await emit('open-file', event, '/tmp/repo')
    await Promise.resolve()

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(mocks.enqueueExternalOpenPath).toHaveBeenCalledWith('/tmp/repo')
    expect(mocks.activateMainWindow).not.toHaveBeenCalled()

    mocks.resolveReady()
    await vi.waitFor(() => {
      expect(mocks.activateMainWindow).toHaveBeenCalled()
    })
  })
})

async function emit(name: string, ...args: any[]): Promise<void> {
  for (const handler of mocks.handlers.get(name) ?? []) await handler(...args)
}
