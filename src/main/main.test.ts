import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, Array<(...args: any[]) => any>>()
  let resolveReady: () => void = () => {}
  let whenReadyPromise = Promise.resolve()
  const settings = {
    lang: 'auto',
    globalShortcutDisabled: false,
    globalShortcut: 'CommandOrControl+Shift+G',
  }
  return {
    handlers,
    settings,
    appOn: vi.fn((name: string, handler: (...args: any[]) => any) => {
      const next = handlers.get(name) ?? []
      next.push(handler)
      handlers.set(name, next)
    }),
    requestSingleInstanceLock: vi.fn(() => true),
    exit: vi.fn(),
    quit: vi.fn(),
    whenReady: vi.fn(() => whenReadyPromise),
    activateMainWindow: vi.fn(() => Promise.resolve({})),
    assertDictionaryParity: vi.fn(),
    buildAppMenu: vi.fn(),
    flushSettings: vi.fn(() => Promise.resolve(true)),
    initTheme: vi.fn(() => Promise.resolve()),
    loadSettings: vi.fn(() => Promise.resolve(settings)),
    resolveLang: vi.fn(() => 'en'),
    setCurrentLang: vi.fn(),
    syncGlobalShortcuts: vi.fn(),
    enqueueExternalOpenPath: vi.fn(() => true),
    unregisterAppShortcuts: vi.fn(),
    wireRpcIpc: vi.fn(),
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
    isPackaged: false,
    on: mocks.appOn,
    exit: mocks.exit,
    quit: mocks.quit,
    requestSingleInstanceLock: mocks.requestSingleInstanceLock,
    show: vi.fn(),
    whenReady: mocks.whenReady,
  },
}))

vi.mock('#/main/window.ts', () => ({
  activateMainWindow: mocks.activateMainWindow,
}))

vi.mock('#/main/theme.ts', () => ({
  initTheme: mocks.initTheme,
}))

vi.mock('#/main/settings.ts', () => ({
  flushSettings: mocks.flushSettings,
  loadSettings: mocks.loadSettings,
}))

vi.mock('#/main/menu.ts', () => ({
  buildAppMenu: mocks.buildAppMenu,
}))

vi.mock('#/main/i18n/index.ts', () => ({
  assertDictionaryParity: mocks.assertDictionaryParity,
  resolveLang: mocks.resolveLang,
  setCurrentLang: mocks.setCurrentLang,
}))

vi.mock('#/main/rpc.ts', () => ({
  wireRpcIpc: mocks.wireRpcIpc,
}))

vi.mock('#/main/terminal.ts', () => ({
  wireTerminalIpc: mocks.wireTerminalIpc,
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
  })

  test('flushes settings and shortcut cleanup before exiting', async () => {
    await import('#/main/main.ts')

    const event = { preventDefault: vi.fn() }
    await emit('before-quit', event)
    const secondPassEvent = { preventDefault: vi.fn() }
    await emit('before-quit', secondPassEvent)

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(mocks.flushSettings).toHaveBeenCalledTimes(1)
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
