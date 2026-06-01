// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SettingsSurface } from '#/renderer/components/SettingsSurface.tsx'
import { useSettingsStore } from '#/renderer/stores/settings.ts'

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}))

function defaultRpcResult(path: string, input?: unknown) {
  if (path === 'githubCli.get' || path === 'githubCli.refresh') {
    const requestedHosts = (input as { hosts?: string[] } | undefined)?.hosts
    const hosts = (requestedHosts && requestedHosts.length > 0 ? requestedHosts : ['github.example.com']).reduce<Record<string, unknown>>(
      (acc, host) => {
        acc[host] = {
          host,
          authenticated: true,
          activeLogin: 'tester',
          logins: ['tester'],
          tokenSource: 'keyring',
        }
        return acc
      },
      {},
    )
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
const testWindow = window as unknown as { goblin?: unknown }
const sendTestNotification = vi.fn(async () => true)
const invokeRpc = vi.fn(async ({ path, input }: { path: string; input?: unknown }) => defaultRpcResult(path, input))

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  sendTestNotification.mockClear()
  toastMocks.success.mockClear()
  toastMocks.error.mockClear()
  invokeRpc.mockClear()
  invokeRpc.mockImplementation(async ({ path, input }: { path: string; input?: unknown }) => defaultRpcResult(path, input))
  testWindow.goblin = {
    homeDir: '/Users/tester',
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
      pruneRepo: vi.fn(),
      notifyBell: vi.fn(),
      sendTestNotification,
      setBadge: vi.fn(),
      onOutput: vi.fn(() => () => {}),
      onExit: vi.fn(() => () => {}),
    },
  }
  useSettingsStore.setState({
    githubCliAvailable: true,
    githubCliVersion: 'gh version 2.93.0',
    githubCliHosts: {},
  })
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  document.body.innerHTML = ''
  delete testWindow.goblin
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

    expect(toastMocks.error).toHaveBeenCalledWith(
      'settings.terminal-notifications-test-failed',
      { description: 'settings.terminal-notifications-test-failed-hint' },
    )
  })

  test('shows GitHub CLI availability and version', async () => {
    useSettingsStore.setState({
      githubCliAvailable: true,
      githubCliVersion: 'gh version 2.93.0',
    })
    await render(<SettingsSurface page="github" onPageChange={() => {}} />)

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

    expect(invokeRpc).toHaveBeenCalledWith(expect.objectContaining({
      path: 'githubCli.refresh',
      input: undefined,
    }))
  })

  test('shows unavailable GitHub CLI status when gh is missing', async () => {
    invokeRpc.mockImplementation(async ({ path, input }: { path: string; input?: unknown }) => {
      if (path === 'githubCli.get' || path === 'githubCli.refresh') {
        const requestedHosts = (input as { hosts?: string[] } | undefined)?.hosts
        const hosts = (requestedHosts && requestedHosts.length > 0 ? requestedHosts : []).reduce<Record<string, unknown>>(
          (acc, host) => {
            acc[host] = { host, authenticated: false, activeLogin: null, logins: [], tokenSource: null }
            return acc
          },
          {},
        )
        return { available: false, version: null, detectedAt: 0, hosts }
      }
      return defaultRpcResult(path, input)
    })
    useSettingsStore.setState({
      githubCliAvailable: false,
      githubCliVersion: null,
      githubCliHosts: {},
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
  await act(async () => {
    root!.render(element)
    await Promise.resolve()
    await Promise.resolve()
  })
}

function buttonByText(text: string): HTMLButtonElement {
  const buttons = Array.from(document.body.querySelectorAll('button'))
  const match = buttons.find((button) => button.textContent?.includes(text))
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Missing button with text: ${text}`)
  return match
}
