// @vitest-environment jsdom

import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SettingsSurface } from '#/web/components/SettingsSurface.tsx'
import { setRendererBridgeForTests } from '#/web/renderer-bridge.ts'

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}))

function defaultRpcResult(path: string, input?: unknown) {
  if (path === 'githubCli.get' || path === 'githubCli.refresh') {
    const requestedHosts = (input as { hosts?: string[] } | undefined)?.hosts
    const hosts = (requestedHosts && requestedHosts.length > 0 ? requestedHosts : ['github.example.com']).reduce<
      Record<string, unknown>
    >((acc, host) => {
      acc[host] = {
        host,
        authenticated: true,
        activeLogin: 'tester',
        logins: ['tester'],
        tokenSource: 'keyring',
      }
      return acc
    }, {})
    return { available: true, version: 'gh version 2.93.0', detectedAt: 0, hosts }
  }
  if (path === 'settings.get') {
    return {
      fetchIntervalSec: 60,
      terminalNotificationsEnabled: false,
      shortcutsDisabled: false,
      globalShortcutDisabled: false,
      swapCloseShortcuts: false,
      toggleDetailOnActionBarBlankClick: false,
      globalShortcut: 'CommandOrControl+Shift+G',
      globalShortcutRegistered: true,
      terminalApp: 'auto',
      editorApp: 'auto',
      lanEnabled: false,
      session: {
        openRepos: [],
        activeRepo: null,
        detailCollapsed: true,
        detailFocusMode: false,
        workspaceLayout: { left: ['sidebar'], center: ['repo'], right: ['detail'] },
        detailPaneSizes: [50, 50],
      },
      recentRepos: [],
    }
  }
  if (path === 'externalApps.get' || path === 'externalApps.refresh') {
    return {
      terminal: {
        pref: 'auto',
        resolved: null,
        available: false,
        appAvailability: { ghostty: false, terminal: false },
        detectedAt: 0,
      },
      editor: {
        pref: 'auto',
        resolved: null,
        available: false,
        appAvailability: { vscode: false, cursor: false, windsurf: false },
        detectedAt: 0,
      },
    }
  }
  if (path === 'settings.setTerminalApp' || path === 'settings.setEditorApp') return input ?? null
  return null
}

vi.mock('sonner', () => ({
  toast: {
    success: toastMocks.success,
    error: toastMocks.error,
  },
}))

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const testWindow = window as unknown as { goblinNative?: unknown; __GOBLIN_BOOTSTRAP__?: unknown }
const sendTestNotification = vi.fn(async () => true)
const invokeRpc = vi.fn(async ({ path, input }: { path: string; input?: unknown }) => defaultRpcResult(path, input))
const fetchMock = vi.fn(async (input: string | URL) => {
  const url = new URL(typeof input === 'string' ? input : input.toString())
  let result: unknown = null
  if (url.pathname === '/api/settings/github-cli/refresh') result = defaultRpcResult('githubCli.refresh')
  else if (url.pathname === '/api/settings/github-cli') {
    result = defaultRpcResult('githubCli.get', { hosts: url.searchParams.getAll('host') })
  } else if (url.pathname === '/api/settings') result = defaultRpcResult('settings.get')
  else if (url.pathname === '/api/settings/external-apps') result = defaultRpcResult('externalApps.get')
  return {
    ok: true,
    json: async () => result,
  }
})

beforeEach(() => {
  setRendererBridgeForTests(null)
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  sendTestNotification.mockClear()
  toastMocks.success.mockClear()
  toastMocks.error.mockClear()
  invokeRpc.mockClear()
  invokeRpc.mockImplementation(async ({ path, input }: { path: string; input?: unknown }) =>
    defaultRpcResult(path, input),
  )
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  testWindow.__GOBLIN_BOOTSTRAP__ = {
    homeDir: '/Users/tester',
    initialI18n: null,
    initialSettings: {
      fetchIntervalSec: 60,
      terminalNotificationsEnabled: false,
      shortcutsDisabled: false,
      globalShortcutDisabled: false,
      swapCloseShortcuts: false,
      toggleDetailOnActionBarBlankClick: false,
      globalShortcut: 'CommandOrControl+Shift+G',
      globalShortcutRegistered: true,
      terminalApp: 'auto',
      editorApp: 'auto',
      lanEnabled: false,
    },
    initialServer: { url: 'http://127.0.0.1:32100/', secret: 'secret' },
  }
  testWindow.goblinNative = {
    homeDir: '/Users/tester',
    initialI18n: null,
    initialSettings: {
      fetchIntervalSec: 60,
      terminalNotificationsEnabled: false,
      shortcutsDisabled: false,
      globalShortcutDisabled: false,
      swapCloseShortcuts: false,
      toggleDetailOnActionBarBlankClick: false,
      globalShortcut: 'CommandOrControl+Shift+G',
      globalShortcutRegistered: true,
      terminalApp: 'auto',
      editorApp: 'auto',
      lanEnabled: false,
    },
    initialServer: { url: 'http://127.0.0.1:32100/', secret: 'secret' },
    pathForFile: () => '',
    invokeRpc,
    abortRpc: async () => true,
    onEvent: () => () => {},
    terminal: {
      open: vi.fn(),
      restart: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      close: vi.fn(),
          create: vi.fn(),
          pruneTerminals: vi.fn(),
      notifyBell: vi.fn(),
      sendTestNotification,
      setBadge: vi.fn(),
      onOutput: vi.fn(() => () => {}),
      onTitle: vi.fn(() => () => {}),
      onExit: vi.fn(() => () => {}),
    },
  }
})

afterEach(() => {
  setRendererBridgeForTests(null)
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  document.body.innerHTML = ''
  delete testWindow.goblinNative
  delete testWindow.__GOBLIN_BOOTSTRAP__
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

describe('SettingsSurface', () => {
  test('can trigger a test terminal notification from settings', async () => {
    await render(<SettingsSurface page="notifications" onPageChange={() => {}} />)

    await act(async () => {
      buttonByText('settings.terminal-notifications-test-button').click()
      await Promise.resolve()
    })

    expect(sendTestNotification).toHaveBeenCalledTimes(1)
    expect(toastMocks.success).toHaveBeenCalledWith('settings.terminal-notifications-test-sent')
  })

  test('shows an error toast when the test notification is blocked', async () => {
    sendTestNotification.mockResolvedValueOnce(false)
    await render(<SettingsSurface page="notifications" onPageChange={() => {}} />)

    await act(async () => {
      buttonByText('settings.terminal-notifications-test-button').click()
      await Promise.resolve()
    })

    expect(toastMocks.error).toHaveBeenCalledWith('settings.terminal-notifications-test-failed', {
      description: 'settings.terminal-notifications-test-failed-hint',
    })
  })

  test('reflects notification preference from the settings query', async () => {
    fetchMock.mockImplementation(async (input: string | URL) => {
      const url = new URL(typeof input === 'string' ? input : input.toString())
      let result: unknown = null
      if (url.pathname === '/api/settings') {
        result = {
          ...defaultRpcResult('settings.get'),
          terminalNotificationsEnabled: true,
        }
      } else if (url.pathname === '/api/settings/github-cli') {
        result = defaultRpcResult('githubCli.get', { hosts: url.searchParams.getAll('host') })
      } else if (url.pathname === '/api/settings/external-apps') {
        result = defaultRpcResult('externalApps.get')
      }
      return {
        ok: true,
        json: async () => result,
      }
    })
    await render(<SettingsSurface page="notifications" onPageChange={() => {}} />)

    await waitForSwitchState('settings-terminal-notifications', 'true')
  })

  test('shows GitHub CLI availability and version', async () => {
    await render(<SettingsSurface page="github" onPageChange={() => {}} />)

    await waitForText('settings.github.status-available')
    expect(document.body.textContent).toContain('settings.github.status-available')
    expect(document.body.textContent).toContain('gh version 2.93.0')
    expect(document.body.textContent).toContain('github.example.com')
    expect(document.body.textContent).toContain('settings.github.auth-signed-in')
  })

  test('refreshes GitHub CLI detection from settings', async () => {
    await render(<SettingsSurface page="github" onPageChange={() => {}} />)

    await act(async () => {
      buttonByText('settings.github.refresh').click()
      await Promise.resolve()
    })

    expect(
      fetchMock.mock.calls.some((call) => {
        const [url, options] = call as unknown as [unknown, RequestInit | undefined]
        if (new URL(String(url)).pathname !== '/api/settings/github-cli/refresh') return false
        return (
          options &&
          typeof options === 'object' &&
          'method' in options &&
          'headers' in options &&
          (options as RequestInit).method === 'POST' &&
          expect
            .objectContaining({
              'content-type': 'application/json',
              'x-goblin-internal-secret': 'secret',
            })
            .asymmetricMatch((options as RequestInit).headers)
        )
      }),
    ).toBe(true)
  })

  test('shows unavailable GitHub CLI status when gh is missing', async () => {
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input.toString())
      let result: unknown = null
      if (url.pathname === '/api/settings/github-cli/refresh') {
        result = { available: false, version: null, detectedAt: 0, hosts: {} }
      } else if (url.pathname === '/api/settings/github-cli') {
        result = { available: false, version: null, detectedAt: 0, hosts: {} }
      } else if (url.pathname === '/api/settings') {
        result = defaultRpcResult('settings.get')
      } else if (url.pathname === '/api/settings/external-apps') {
        result = defaultRpcResult(init?.method === 'POST' ? 'externalApps.refresh' : 'externalApps.get')
      }
      return {
        ok: true,
        json: async () => result,
      }
    })
    await render(<SettingsSurface page="github" onPageChange={() => {}} />)

    expect(document.body.textContent).toContain('settings.github.status-unavailable')
    expect(document.body.textContent).toContain('settings.github.hint-missing')
  })

  test('renders the SSH remotes settings page', async () => {
    await render(<SettingsSurface page="ssh" onPageChange={() => {}} />)

    expect(document.body.textContent).toContain('settings.ssh.title')
    expect(document.body.textContent).toContain('settings.ssh.body')
    expect(document.body.textContent).toContain('settings.ssh.example')
  })
})

async function render(element: React.ReactNode) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  })
  await act(async () => {
    root!.render(<QueryClientProvider client={queryClient}>{element}</QueryClientProvider>)
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function waitForText(text: string) {
  for (let i = 0; i < 5; i += 1) {
    if (document.body.textContent?.includes(text)) return
    await act(async () => {
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  throw new Error(`Missing text: ${text}`)
}

function buttonByText(text: string): HTMLButtonElement {
  const buttons = Array.from(document.body.querySelectorAll('button'))
  const match = buttons.find((button) => button.textContent?.includes(text))
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Missing button with text: ${text}`)
  return match
}

function switchById(id: string): HTMLButtonElement {
  const match = document.getElementById(id)
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Missing switch with id: ${id}`)
  return match
}

async function waitForSwitchState(id: string, checked: 'true' | 'false') {
  for (let i = 0; i < 5; i += 1) {
    if (switchById(id).getAttribute('aria-checked') === checked) return
    await act(async () => {
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  throw new Error(`Switch ${id} did not reach ${checked}`)
}
