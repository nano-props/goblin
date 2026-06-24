// @vitest-environment jsdom

import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SettingsSurface } from '#/web/components/SettingsSurface.tsx'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import { useHostInfoStore } from '#/web/stores/host-info.ts'
import { resetReposStore } from '#/web/stores/repos/test-utils.ts'

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}))

function defaultIpcResult(path: string, input?: unknown) {
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
      globalShortcut: 'CommandOrControl+Shift+G',
      globalShortcutRegistered: true,
      terminalApp: 'auto',
      editorApp: 'auto',
      lanEnabled: false,
      session: {
        openRepos: [],
        activeRepo: null,
        workspaceFocused: true,
        workspacePaneSize: 50,
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
        appAvailability: { ghostty: false, terminal: false, windowsTerminal: false },
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
const invokeIpc = vi.fn(async ({ path, input }: { path: string; input?: unknown }) => defaultIpcResult(path, input))
const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input.toString())
  const rawBody = typeof init?.body === 'string' && init.body.length > 0 ? init.body : ''
  const body = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {}
  let result: unknown = null
  if (url.pathname === '/api/settings/github-cli/refresh') result = defaultIpcResult('githubCli.refresh', body)
  else if (url.pathname === '/api/settings/github-cli') {
    result = defaultIpcResult('githubCli.get', body)
  } else if (url.pathname === '/api/settings') result = defaultIpcResult('settings.get')
  else if (url.pathname === '/api/settings/external-apps') result = defaultIpcResult('externalApps.get')
  return {
    ok: true,
    json: async () => result,
  }
})

beforeEach(() => {
  setClientBridgeForTests(null)
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  resetReposStore()
  sendTestNotification.mockClear()
  toastMocks.success.mockClear()
  toastMocks.error.mockClear()
  invokeIpc.mockClear()
  invokeIpc.mockImplementation(async ({ path, input }: { path: string; input?: unknown }) =>
    defaultIpcResult(path, input),
  )
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  // Host info used to live in the bootstrap payload; it now lives
  // on the public `/api/host` endpoint and the renderer-side
  // `useHostInfoStore`. Seed the store directly so tests don't
  // have to mock `fetch('/api/host')` for every scenario.
  useHostInfoStore.setState({
    snapshot: { homeDir: '/Users/tester', platform: 'darwin', hostname: 'test', pid: 1 },
    hydrated: true,
  })
  testWindow.__GOBLIN_BOOTSTRAP__ = {
    runtime: {
      kind: 'electron',
      bridgeVersion: 1,
      capabilities: [
        'settings-ipc',
        'open-settings-window',
        'open-external-url',
        'open-directory-dialog',
        'consume-external-open-paths',
        'open-in-finder',
        'terminal-notifications',
        'terminal-badge',
      ],
    },
    initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' },
  }
  testWindow.goblinNative = {
    pathForFile: () => '',
    invokeIpc,
    abortIpc: async () => true,
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
  setClientBridgeForTests(null)
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
  test('does not show the removed workspace layout selector on the general page', async () => {
    await render(<SettingsSurface page="general" onPageChange={() => {}} />)

    expect(document.getElementById('settings-workspace-layout')).toBeNull()
    expect(document.body.textContent).not.toContain('settings.workspace-layout')
    expect(document.body.textContent).not.toContain('settings.workspace-layout-hint')
  })

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
      description: 'settings.terminal-notifications-test-failed-hint.mac',
    })
  })

  test('reflects notification preference from the settings query', async () => {
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input.toString())
      const rawBody = typeof init?.body === 'string' && init.body.length > 0 ? init.body : ''
      const body = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {}
      let result: unknown = null
      if (url.pathname === '/api/settings') {
        result = {
          ...defaultIpcResult('settings.get'),
          terminalNotificationsEnabled: true,
        }
      } else if (url.pathname === '/api/settings/github-cli') {
        result = defaultIpcResult('githubCli.get', body)
      } else if (url.pathname === '/api/settings/external-apps') {
        result = defaultIpcResult('externalApps.get')
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
              'x-goblin-access-token': 'secret',
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
        result = defaultIpcResult('settings.get')
      } else if (url.pathname === '/api/settings/external-apps') {
        result = defaultIpcResult(init?.method === 'POST' ? 'externalApps.refresh' : 'externalApps.get')
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
