import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { SettingsSnapshot } from '#/shared/api-types.ts'
import { defaultSettingsSnapshot } from '#/shared/settings-defaults.ts'

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, Array<(...args: any[]) => any>>()
  const ipcHandlers = new Map<string, (...args: any[]) => any>()
  const timeouts = new Map<number, () => void>()
  let timeoutId = 0
  let resolveReady: () => void = () => {}
  let whenReadyPromise = Promise.resolve()
  return {
    handlers,
    ipcHandlers,
    timeouts,
    setTimeout: vi.fn((handler: () => void) => {
      timeoutId += 1
      timeouts.set(timeoutId, handler)
      return timeoutId
    }),
    clearTimeout: vi.fn((id: number) => {
      timeouts.delete(id)
    }),
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
    activatePrimaryWindow: vi.fn(() => Promise.resolve({})),
    assertDictionaryParity: vi.fn(),
    buildAppMenu: vi.fn(),
    flushWindowState: vi.fn(() => Promise.resolve(true)),
    getSettingsSnapshot: vi.fn<() => Promise<SettingsSnapshot>>(),
    setGlobalShortcutState: vi.fn(async () => true),
    initializeMenuRuntimeState: vi.fn(),
    initTheme: vi.fn(() => Promise.resolve()),
    resolveLang: vi.fn(() => 'en'),
    setCurrentLang: vi.fn(),
    syncGlobalShortcuts: vi.fn(),
    enqueueExternalOpenPath: vi.fn(() => true),
    unregisterAppShortcuts: vi.fn(),
    wireNativeHostIpc: vi.fn(),
    broadcastClientEffectIntent: vi.fn(),
    wireShellIpc: vi.fn(),
    wireTerminalIpc: vi.fn(),
    wireClipboardIpc: vi.fn(),
    wireAccessTokenIpc: vi.fn(),
    isTrustedIpcEvent: vi.fn(() => true),
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
  // wireNativeHostIpc() registers IPC handlers; the test never reads
  // from them but the calls must not throw, so we expose a no-op ipcMain.
  ipcMain: {
    on: vi.fn(),
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      mocks.ipcHandlers.set(channel, handler)
    }),
    removeHandler: vi.fn((channel: string) => {
      mocks.ipcHandlers.delete(channel)
    }),
    removeAllListeners: vi.fn(),
  },
}))

vi.mock('#/main/window.ts', () => ({
  activatePrimaryWindow: mocks.activatePrimaryWindow,
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

vi.mock('#/main/native-host-ipc-router.ts', () => ({
  wireNativeHostIpc: mocks.wireNativeHostIpc,
}))

vi.mock('#/main/client-surface-events.ts', () => ({
  broadcastClientEffectIntent: mocks.broadcastClientEffectIntent,
}))

vi.mock('#/main/shell-ipc.ts', () => ({
  wireShellIpc: mocks.wireShellIpc,
}))

vi.mock('#/main/terminal.ts', () => ({
  wireTerminalIpc: mocks.wireTerminalIpc,
}))

vi.mock('#/main/settings-server-client.ts', () => ({
  getSettingsSnapshot: mocks.getSettingsSnapshot,
  setGlobalShortcutState: mocks.setGlobalShortcutState,
}))

vi.mock('#/main/embedded-server-lifecycle.ts', () => ({
  startEmbeddedServer: vi.fn(() => Promise.resolve()),
  stopEmbeddedServer: vi.fn(() => Promise.resolve()),
}))

vi.mock('#/main/clipboard-ipc.ts', () => ({
  wireClipboardIpc: mocks.wireClipboardIpc,
}))

vi.mock('#/main/access-token-ipc.ts', () => ({
  wireAccessTokenIpc: mocks.wireAccessTokenIpc,
}))

vi.mock('#/main/ipc/trusted-webcontents.ts', () => ({
  isTrustedIpcEvent: mocks.isTrustedIpcEvent,
}))

vi.mock('#/main/shortcuts.ts', () => ({
  syncGlobalShortcuts: mocks.syncGlobalShortcuts,
  unregisterAppShortcuts: mocks.unregisterAppShortcuts,
}))

vi.mock('#/main/external-open.ts', () => ({
  enqueueExternalOpenPath: mocks.enqueueExternalOpenPath,
}))

describe('native host startup lifecycle', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.handlers.clear()
    mocks.ipcHandlers.clear()
    mocks.isTrustedIpcEvent.mockReturnValue(true)
    mocks.resetReady()
    mocks.getSettingsSnapshot.mockResolvedValue(defaultSettingsSnapshot())
  })

  test('flushes settings and shortcut cleanup before exiting', async () => {
    await import('#/main/main.ts')

    const event = { preventDefault: vi.fn() }
    const quitting = emit('before-quit', event)
    await vi.waitFor(() => {
      expect(mocks.broadcastClientEffectIntent).toHaveBeenCalledWith({ type: 'app-quitting' })
    })
    expect(mocks.flushWindowState).not.toHaveBeenCalled()
    await mocks.ipcHandlers.get('goblin:app-quit-drained')?.(null, { ok: true })
    await quitting
    const secondPassEvent = { preventDefault: vi.fn() }
    await emit('before-quit', secondPassEvent)

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(mocks.broadcastClientEffectIntent).toHaveBeenCalledWith({ type: 'app-quitting' })
    expect(mocks.flushWindowState).toHaveBeenCalledTimes(1)
    expect(mocks.unregisterAppShortcuts).toHaveBeenCalledTimes(1)
    expect(mocks.exit).toHaveBeenCalledWith(0)
    expect(mocks.quit).not.toHaveBeenCalled()
    expect(secondPassEvent.preventDefault).not.toHaveBeenCalled()
  })

  test('does not wait for timeout when the client quit drain reports failure', async () => {
    await import('#/main/main.ts')

    const event = { preventDefault: vi.fn() }
    const quitting = emit('before-quit', event)
    await vi.waitFor(() => {
      expect(mocks.broadcastClientEffectIntent).toHaveBeenCalledWith({ type: 'app-quitting' })
    })

    await mocks.ipcHandlers
      .get('goblin:app-quit-drained')
      ?.(null, { ok: false, error: { name: 'Error', message: 'disk full' } })
    await quitting

    expect(mocks.flushWindowState).toHaveBeenCalledTimes(1)
    expect(mocks.exit).toHaveBeenCalledWith(0)
    mocks.timeouts.values().next().value?.()
    expect(mocks.flushWindowState).toHaveBeenCalledTimes(1)
    expect(mocks.exit).toHaveBeenCalledTimes(1)
  })

  test('ignores untrusted client quit drain acknowledgements', async () => {
    await import('#/main/main.ts')

    const event = { preventDefault: vi.fn() }
    const quitting = emit('before-quit', event)
    await vi.waitFor(() => {
      expect(mocks.broadcastClientEffectIntent).toHaveBeenCalledWith({ type: 'app-quitting' })
    })

    mocks.isTrustedIpcEvent.mockReturnValueOnce(false)
    const untrustedResult = await mocks.ipcHandlers.get('goblin:app-quit-drained')?.({ sender: { id: 99 } }, { ok: true })
    expect(untrustedResult).toBe(false)
    expect(mocks.flushWindowState).not.toHaveBeenCalled()

    await mocks.ipcHandlers.get('goblin:app-quit-drained')?.({ sender: { id: 1 } }, { ok: true })
    await quitting

    expect(mocks.flushWindowState).toHaveBeenCalledTimes(1)
    expect(mocks.exit).toHaveBeenCalledWith(0)
  })

  test('defers second-instance activation until startup initialization finishes', async () => {
    await import('#/main/main.ts')

    await emit('second-instance')
    await Promise.resolve()
    expect(mocks.activatePrimaryWindow).not.toHaveBeenCalled()

    mocks.resolveReady()
    await vi.waitFor(() => {
      expect(mocks.buildAppMenu).toHaveBeenCalled()
      expect(mocks.activatePrimaryWindow).toHaveBeenCalled()
    })
  })

  test('does not activate or create a window if quit starts before initialization finishes', async () => {
    await import('#/main/main.ts')

    await emit('second-instance')
    await emit('before-quit', { preventDefault: vi.fn() })
    mocks.resolveReady()

    await vi.waitFor(() => {
      expect(mocks.buildAppMenu).toHaveBeenCalled()
    })
    mocks.timeouts.values().next().value?.()
    await vi.waitFor(() => {
      expect(mocks.exit).toHaveBeenCalledWith(0)
    })

    expect(mocks.activatePrimaryWindow).not.toHaveBeenCalled()
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
      session: snapshot.session,
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
    expect(mocks.activatePrimaryWindow).not.toHaveBeenCalled()

    mocks.resolveReady()
    await vi.waitFor(() => {
      expect(mocks.activatePrimaryWindow).toHaveBeenCalled()
    })
  })
})

async function emit(name: string, ...args: any[]): Promise<void> {
  for (const handler of mocks.handlers.get(name) ?? []) await handler(...args)
}
