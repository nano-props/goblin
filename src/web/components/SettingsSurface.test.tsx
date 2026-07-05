// @vitest-environment jsdom
import { act } from '@testing-library/react'
import { mockFetch } from '#/test-utils/fetch-mock.ts'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SettingsSurface } from '#/web/components/SettingsSurface.tsx'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import { useHostInfoStore } from '#/web/stores/host-info.ts'
import { resetReposStore } from '#/web/test-utils/bridge.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'

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
      lanEnabled: false,
      session: {
        openRepoEntries: [],
        restoredRepoId: null,
        zenMode: true,
        workspacePaneSize: 50,
      },
      recentRepos: [],
    }
  }
  if (path === 'externalApps.get' || path === 'externalApps.refresh') {
    return {
      terminal: {
        available: false,
        appAvailability: { ghostty: false, terminal: false, windowsTerminal: false },
        detectedAt: 0,
      },
      editor: {
        available: false,
        appAvailability: { vscode: false },
        detectedAt: 0,
      },
    }
  }
  return null
}

vi.mock('sonner', () => ({
  toast: {
    success: toastMocks.success,
    error: toastMocks.error,
  },
}))

const testWindow = window as unknown as { goblinNative?: unknown; __GOBLIN_BOOTSTRAP__?: unknown }
const sendTestNotification = vi.fn(async () => true)
const invokeIpc = vi.fn(async ({ path, input }: { path: string; input?: unknown }) => defaultIpcResult(path, input))
const fetchMock = mockFetch(async (input: RequestInfo | URL, init?: RequestInit) => {
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
  resetReposStore()
  sendTestNotification.mockClear()
  toastMocks.success.mockClear()
  toastMocks.error.mockClear()
  invokeIpc.mockClear()
  invokeIpc.mockImplementation(async ({ path, input }: { path: string; input?: unknown }) =>
    defaultIpcResult(path, input),
  )
  fetchMock.mockClear()
  // Host info used to live in the bootstrap payload; it now lives
  // on the public `/api/host` endpoint and the client-side
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
      onBell: vi.fn(() => () => {}),
      onTitle: vi.fn(() => () => {}),
      onExit: vi.fn(() => () => {}),
    },
  }
})

afterEach(() => {
  setClientBridgeForTests(null)
  delete testWindow.goblinNative
  delete testWindow.__GOBLIN_BOOTSTRAP__
})

describe('SettingsSurface', () => {
  test('does not show the removed workspace layout selector on the general page', async () => {
    const { container } = render(<SettingsSurface page="general" onPageChange={() => {}} />)

    expect(container.querySelector('#settings-workspace-layout')).toBeNull()
    expect(container.textContent).not.toContain('settings.workspace-layout')
    expect(container.textContent).not.toContain('settings.workspace-layout-hint')
  })

  test('keeps settings navigation selected state and page changes wired', async () => {
    const onPageChange = vi.fn()
    const { container } = render(
      <SettingsSurface page="general" onPageChange={onPageChange} autoFocusSelected={false} />,
    )

    const general = container.querySelector('button[aria-label="settings.group.general"]')
    if (!(general instanceof HTMLButtonElement)) throw new Error('missing general settings nav row')
    expect(general.getAttribute('aria-current')).toBe('page')

    const shortcuts = container.querySelector('button[aria-label="settings.nav.shortcuts"]')
    if (!(shortcuts instanceof HTMLButtonElement)) throw new Error('missing shortcuts settings nav row')
    await act(async () => {
      shortcuts.click()
      await Promise.resolve()
    })
    expect(onPageChange).toHaveBeenCalledWith('shortcuts')
  })

  test('can trigger a test terminal notification from settings', async () => {
    const { container } = render(<SettingsSurface page="notifications" onPageChange={() => {}} />)

    await act(async () => {
      buttonByText(container, 'settings.terminal-notifications-test-button').click()
      await Promise.resolve()
    })

    expect(sendTestNotification).toHaveBeenCalledTimes(1)
    expect(sendTestNotification).toHaveBeenCalledWith({
      title: 'settings.terminal-notifications-test-title',
      body: 'settings.terminal-notifications-test-body',
    })
    expect(toastMocks.success).toHaveBeenCalledWith('settings.terminal-notifications-test-sent')
  })

  test('shows an error toast when the test notification is blocked', async () => {
    sendTestNotification.mockResolvedValueOnce(false)
    const { container } = render(<SettingsSurface page="notifications" onPageChange={() => {}} />)

    await act(async () => {
      buttonByText(container, 'settings.terminal-notifications-test-button').click()
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
    const { container } = render(<SettingsSurface page="notifications" onPageChange={() => {}} />)

    await waitForSwitchState(container, 'settings-terminal-notifications', 'true')
  })

  test('shows GitHub CLI availability and version', async () => {
    const { container } = render(<SettingsSurface page="github" onPageChange={() => {}} />)

    await waitForText(container, 'settings.github.status-available')
    expect(container.textContent).toContain('settings.github.status-available')
    expect(container.textContent).toContain('gh version 2.93.0')
    expect(container.textContent).toContain('github.example.com')
    expect(container.textContent).toContain('settings.github.auth-signed-in')
  })

  test('refreshes GitHub CLI detection from settings', async () => {
    const { container } = render(<SettingsSurface page="github" onPageChange={() => {}} />)

    await act(async () => {
      buttonByText(container, 'settings.github.refresh').click()
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
    const { container } = render(<SettingsSurface page="github" onPageChange={() => {}} />)

    expect(container.textContent).toContain('settings.github.status-unavailable')
    expect(container.textContent).toContain('settings.github.hint-missing')
  })

  test('renders the SSH remotes settings page', async () => {
    const { container } = render(<SettingsSurface page="ssh" onPageChange={() => {}} />)

    expect(container.textContent).toContain('settings.ssh.title')
    expect(container.textContent).toContain('settings.ssh.body')
    expect(container.textContent).toContain('settings.ssh.example')
  })
})

function render(element: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  })
  return renderInJsdom(<QueryClientProvider client={queryClient}>{element}</QueryClientProvider>)
}

async function waitForText(container: HTMLElement, text: string) {
  for (let i = 0; i < 5; i += 1) {
    if (container.textContent?.includes(text)) return
    await act(async () => {
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  throw new Error(`Missing text: ${text}`)
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const buttons = Array.from(container.querySelectorAll('button'))
  const match = buttons.find((button) => button.textContent?.includes(text))
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Missing button with text: ${text}`)
  return match
}

function switchById(container: HTMLElement, id: string): HTMLButtonElement {
  const match = container.querySelector(`#${id}`)
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Missing switch with id: ${id}`)
  return match
}

async function waitForSwitchState(container: HTMLElement, id: string, checked: 'true' | 'false') {
  for (let i = 0; i < 5; i += 1) {
    if (switchById(container, id).getAttribute('aria-checked') === checked) return
    await act(async () => {
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  throw new Error(`Switch ${id} did not reach ${checked}`)
}
