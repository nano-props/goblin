import { beforeEach, describe, expect, test, vi } from 'vitest'
import { setRendererBridgeForTests } from '#/web/renderer-bridge.ts'
import { useSessionRestoreStore } from '#/web/stores/session-restore.ts'

function installBridge(sessionOverrides: Record<string, unknown> = {}) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      __GOBLIN_BOOTSTRAP__: {
        initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' },
      },
      goblinNative: {
        initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' },
        invokeIpc: vi.fn(({ path }: { path: string }) => {
          if (path !== 'settings.get') throw new Error(`Unhandled IPC path: ${path}`)
          return {
            theme: 'auto',
            colorTheme: 'default',
            fetchIntervalSec: 120,
            terminalNotificationsEnabled: false,
            shortcutsDisabled: false,
            globalShortcutDisabled: false,
            globalShortcut: 'CommandOrControl+Shift+G',
            globalShortcutRegistered: false,
            terminalApp: 'auto',
            editorApp: 'auto',
            lanEnabled: false,
            session: {
              openRepos: [],
              activeRepo: null,
              workspaceFocused: true,
              workspacePaneSize: 0.5,
              selectedTerminalByWorktree: {},
              ...sessionOverrides,
            },
            recentRepos: [],
          }
        }),
        abortIpc: () => Promise.resolve(false),
        onEvent: () => () => {},
        pathForFile: () => '',
      },
      location: {
        href: 'http://127.0.0.1:32100/',
        origin: 'http://127.0.0.1:32100',
        search: '',
      },
    },
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      const url = new URL(typeof input === 'string' ? input : input.toString())
      if (url.pathname !== '/api/settings') throw new Error(`Unhandled fetch URL: ${url.pathname}`)
      return {
        ok: true,
        json: async () => window.goblinNative.invokeIpc({ path: 'settings.get' }),
      }
    }),
  )
  setRendererBridgeForTests(null)
}

describe('session restore store', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    installBridge()
    useSessionRestoreStore.setState({ bootSessionSnapshot: null })
  })

  test('hydrate stores the saved session snapshot for bootstrap consumers', async () => {
    await useSessionRestoreStore.getState().hydrate()

    expect(useSessionRestoreStore.getState().bootSessionSnapshot).toMatchObject({
      openRepos: [],
      activeRepo: null,
      workspacePaneSize: 0.5,
    })
  })

  test('consumeBootSessionSnapshot returns the hydrated session snapshot once and then clears it', async () => {
    installBridge({
      openRepos: [{ kind: 'local', id: '/tmp/repo' }],
      activeRepo: '/tmp/repo',
      workspaceFocused: false,
      workspacePaneSize: 0.4,
    })

    await useSessionRestoreStore.getState().hydrate()

    expect(useSessionRestoreStore.getState().consumeBootSessionSnapshot()).toMatchObject({
      openRepos: [{ kind: 'local', id: '/tmp/repo' }],
      activeRepo: '/tmp/repo',
      workspaceFocused: false,
      workspacePaneSize: 0.4,
    })
    expect(useSessionRestoreStore.getState().bootSessionSnapshot).toBeNull()
    expect(useSessionRestoreStore.getState().consumeBootSessionSnapshot()).toMatchObject({
      openRepos: [],
      activeRepo: null,
      workspaceFocused: false,
      workspacePaneSize: 61.8,
    })
  })
})
