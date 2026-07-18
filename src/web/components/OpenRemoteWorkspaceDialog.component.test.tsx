// @vitest-environment jsdom
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

import { act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { OpenRemoteWorkspaceDialog } from '#/web/components/OpenRemoteWorkspaceDialog.tsx'
import {
  PrimaryWindowNavigationProvider,
  type PrimaryWindowNavigationActions,
} from '#/web/primary-window-navigation.tsx'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import { ELECTRON_CLIENT_CAPABILITIES, CLIENT_BRIDGE_VERSION } from '#/shared/bootstrap.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { resetReposStore } from '#/web/test-utils/bridge.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    error: mocks.toastError,
  },
}))

const testWindow = window as unknown as { goblinNative?: unknown; __GOBLIN_BOOTSTRAP__?: unknown }

const target = {
  id: 'goblin+ssh://prod/srv/repo',
  alias: 'prod',
  host: 'example.com',
  user: 'alice',
  port: 22,
  remotePath: '/srv/repo',
  displayName: 'prod:repo',
} as const

beforeEach(() => {
  vi.clearAllMocks()
  resetReposStore()
  setClientBridgeForTests(null)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input.toString())
      const body =
        typeof init?.body === 'string' && init.body.length > 0 ? (JSON.parse(init.body) as Record<string, any>) : {}
      if (url.pathname === '/api/remote/ssh-hosts') {
        return { ok: true, json: async () => ({ hosts: [], hasInclude: true }) }
      }
      if (url.pathname === '/api/remote/resolve-target') {
        return {
          ok: true,
          json: async () => ({ target: { ...target, alias: body.alias, remotePath: body.remotePath } }),
        }
      }
      if (url.pathname === '/api/remote/test-repo') {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            target: body.target,
            stages: [{ name: 'path', label: 'path', status: 'passed' }],
          }),
        }
      }
      if (url.pathname === '/api/remote/path-suggestions') {
        return { ok: true, json: async () => [] }
      }
      throw new Error(`Unhandled fetch URL: ${url.pathname}`)
    }),
  )
  testWindow.__GOBLIN_BOOTSTRAP__ = {
    runtime: {
      kind: 'electron',
      bridgeVersion: CLIENT_BRIDGE_VERSION,
      capabilities: [...ELECTRON_CLIENT_CAPABILITIES],
    },
    initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' },
  }
  Object.defineProperty(window, 'goblinNative', {
    configurable: true,
    value: {
      runtime: {
        kind: 'electron',
        bridgeVersion: CLIENT_BRIDGE_VERSION,
        capabilities: [...ELECTRON_CLIENT_CAPABILITIES],
      },
      pathForFile: () => '',
      invokeIpc: async () => null,
      abortIpc: async () => true,
      onEvent: () => () => {},
    },
  })
})

afterEach(() => {
  delete testWindow.goblinNative
  delete testWindow.__GOBLIN_BOOTSTRAP__
  setClientBridgeForTests(null)
})

describe('OpenRemoteWorkspaceDialog', () => {
  test('keeps the remote status row mounted before running a connection test', async () => {
    render(
      <PrimaryWindowNavigationProvider value={navigationWith({})}>
        <OpenRemoteWorkspaceDialog open onOpenChange={vi.fn()} />
      </PrimaryWindowNavigationProvider>,
    )
    await flush()

    expect(document.body.querySelector('[data-slot="remote-diagnostics-status"]')).not.toBeNull()
  })

  test('renders a minimal remote status row in the initial state', async () => {
    render(
      <PrimaryWindowNavigationProvider value={navigationWith({})}>
        <OpenRemoteWorkspaceDialog open onOpenChange={vi.fn()} />
      </PrimaryWindowNavigationProvider>,
    )
    await flush()

    expect(document.body.querySelector('[data-slot="remote-diagnostics-status"]')).not.toBeNull()
    expect(document.body.querySelector('[data-slot="dialog-status-row"]')).not.toBeNull()
    expect(document.body.textContent).toContain('workspace-picker.open-remote-diagnostics-idle-detail')
    expect(document.body.textContent).not.toContain('workspace-picker.open-remote-path-required')
  })

  test('updates typed values in the host and path inputs', async () => {
    render(
      <PrimaryWindowNavigationProvider value={navigationWith({})}>
        <OpenRemoteWorkspaceDialog open onOpenChange={vi.fn()} />
      </PrimaryWindowNavigationProvider>,
    )
    await flush()

    setInputValue('#remote-ssh-host', 'prod')
    setInputValue('#remote-path', '/srv/repo')

    expect(input('#remote-ssh-host').value).toBe('prod')
    expect(input('#remote-path').value).toBe('/srv/repo')
    expect(document.body.textContent).not.toContain('prod:/srv/repo')
  })

  test('shows a success tip after a passing connection test', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = new URL(typeof input === 'string' ? input : input.toString())
        const body =
          typeof init?.body === 'string' && init.body.length > 0 ? (JSON.parse(init.body) as Record<string, any>) : {}
        if (url.pathname === '/api/remote/ssh-hosts') {
          return { ok: true, json: async () => ({ hosts: [], hasInclude: true }) }
        }
        if (url.pathname === '/api/remote/resolve-target') {
          return {
            ok: true,
            json: async () => ({
              target: { ...target, alias: body.alias, remotePath: '/home/alice/repo' },
            }),
          }
        }
        if (url.pathname === '/api/remote/test-repo') {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              target: body.target,
              stages: [{ name: 'path', label: 'path', status: 'passed' }],
            }),
          }
        }
        if (url.pathname === '/api/remote/path-suggestions') {
          return { ok: true, json: async () => [] }
        }
        throw new Error(`Unhandled fetch URL: ${url.pathname}`)
      }),
    )

    render(
      <PrimaryWindowNavigationProvider value={navigationWith({})}>
        <OpenRemoteWorkspaceDialog open onOpenChange={vi.fn()} />
      </PrimaryWindowNavigationProvider>,
    )
    await flush()

    setInputValue('#remote-ssh-host', 'prod')
    setInputValue('#remote-path', '~/repo')
    clickButtonByText('workspace-picker.open-remote-test-connection')
    await flush()

    expect(document.body.textContent).toContain('workspace-picker.open-remote-diagnostics-ok')
  })

  test('shows a testing tip while connection test is running', async () => {
    let resolveTest: ((value: { ok: true; target: typeof target; stages: [] }) => void) | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = new URL(typeof input === 'string' ? input : input.toString())
        const body =
          typeof init?.body === 'string' && init.body.length > 0 ? (JSON.parse(init.body) as Record<string, any>) : {}
        if (url.pathname === '/api/remote/ssh-hosts') {
          return { ok: true, json: async () => ({ hosts: [], hasInclude: true }) }
        }
        if (url.pathname === '/api/remote/resolve-target') {
          return {
            ok: true,
            json: async () => ({ target: { ...target, alias: body.alias, remotePath: body.remotePath } }),
          }
        }
        if (url.pathname === '/api/remote/test-repo') {
          return {
            ok: true,
            json: () =>
              new Promise((resolve) => {
                resolveTest = resolve as (value: { ok: true; target: typeof target; stages: [] }) => void
              }),
          }
        }
        if (url.pathname === '/api/remote/path-suggestions') {
          return { ok: true, json: async () => [] }
        }
        throw new Error(`Unhandled fetch URL: ${url.pathname}`)
      }),
    )

    render(
      <PrimaryWindowNavigationProvider value={navigationWith({})}>
        <OpenRemoteWorkspaceDialog open onOpenChange={vi.fn()} />
      </PrimaryWindowNavigationProvider>,
    )
    await flush()

    setInputValue('#remote-ssh-host', 'prod')
    setInputValue('#remote-path', '/srv/repo')
    clickButtonByText('workspace-picker.open-remote-test-connection')
    await flush()

    expect(document.body.textContent).toContain('workspace-picker.open-remote-diagnostics-testing')

    if (resolveTest) resolveTest({ ok: true, target, stages: [] })
    await flush()
  })

  test('shows copy-details next to a failed status tip', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = new URL(typeof input === 'string' ? input : input.toString())
        const body =
          typeof init?.body === 'string' && init.body.length > 0 ? (JSON.parse(init.body) as Record<string, any>) : {}
        if (url.pathname === '/api/remote/ssh-hosts') {
          return { ok: true, json: async () => ({ hosts: [], hasInclude: true }) }
        }
        if (url.pathname === '/api/remote/resolve-target') {
          return {
            ok: true,
            json: async () => ({ target: { ...target, alias: body.alias, remotePath: body.remotePath } }),
          }
        }
        if (url.pathname === '/api/remote/test-repo') {
          return {
            ok: true,
            json: async () => ({
              ok: false,
              target: body.target,
              category: 'handshake-failed',
              message: 'handshake-failed',
              details: 'full diagnostic details',
              stages: [],
            }),
          }
        }
        if (url.pathname === '/api/remote/path-suggestions') {
          return { ok: true, json: async () => [] }
        }
        throw new Error(`Unhandled fetch URL: ${url.pathname}`)
      }),
    )

    render(
      <PrimaryWindowNavigationProvider value={navigationWith({})}>
        <OpenRemoteWorkspaceDialog open onOpenChange={vi.fn()} />
      </PrimaryWindowNavigationProvider>,
    )
    await flush()

    setInputValue('#remote-ssh-host', 'prod')
    setInputValue('#remote-path', '/srv/repo')
    clickButtonByText('workspace-picker.open-remote-test-connection')
    await flush()

    const copyButton = findButtonByText('workspace-picker.open-remote-diagnostics-copy-details')
    const row = copyButton.parentElement
    expect(row?.textContent).toContain('handshake-failed')
    expect(row?.textContent).toContain('workspace-picker.open-remote-diagnostics-copy-details')
  })

  test('does not reserve an empty helper row below the SSH alias select', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = new URL(typeof input === 'string' ? input : input.toString())
        const body =
          typeof init?.body === 'string' && init.body.length > 0 ? (JSON.parse(init.body) as Record<string, any>) : {}
        if (url.pathname === '/api/remote/ssh-hosts') {
          return {
            ok: true,
            json: async () => ({ hosts: [{ alias: 'prod', hostName: 'example.com' }], hasInclude: false }),
          }
        }
        if (url.pathname === '/api/remote/resolve-target') {
          return {
            ok: true,
            json: async () => ({ target: { ...target, alias: body.alias, remotePath: body.remotePath } }),
          }
        }
        if (url.pathname === '/api/remote/test-repo') {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              target: body.target,
              stages: [{ name: 'path', label: 'path', status: 'passed' }],
            }),
          }
        }
        if (url.pathname === '/api/remote/path-suggestions') {
          return { ok: true, json: async () => [] }
        }
        throw new Error(`Unhandled fetch URL: ${url.pathname}`)
      }),
    )

    render(
      <PrimaryWindowNavigationProvider value={navigationWith({})}>
        <OpenRemoteWorkspaceDialog open onOpenChange={vi.fn()} />
      </PrimaryWindowNavigationProvider>,
    )
    await flush()

    const descriptions = document.body.querySelectorAll('[data-slot="field-description"]')
    expect(descriptions).toHaveLength(1)
  })

  test('keeps the empty remote path in a neutral state until the user types an invalid path', async () => {
    render(
      <PrimaryWindowNavigationProvider value={navigationWith({})}>
        <OpenRemoteWorkspaceDialog open onOpenChange={vi.fn()} />
      </PrimaryWindowNavigationProvider>,
    )
    await flush()

    expect(document.body.textContent).not.toContain('workspace-picker.open-remote-path-required')

    setInputValue('#remote-path', 'repo')

    expect(document.body.textContent).toContain('workspace-picker.open-remote-path-absolute')
  })

  test('focuses the host alias input when include mode requires manual host entry', async () => {
    const onOpenChange = vi.fn()

    render(
      <PrimaryWindowNavigationProvider value={navigationWith({})}>
        <OpenRemoteWorkspaceDialog open onOpenChange={onOpenChange} />
      </PrimaryWindowNavigationProvider>,
    )
    await flush()

    expect(document.activeElement).toBe(input('#remote-ssh-host'))
  })

  test('focuses the remote path input when a host is already selected from ssh config', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = new URL(typeof input === 'string' ? input : input.toString())
        const body =
          typeof init?.body === 'string' && init.body.length > 0 ? (JSON.parse(init.body) as Record<string, any>) : {}
        if (url.pathname === '/api/remote/ssh-hosts') {
          return {
            ok: true,
            json: async () => ({ hosts: [{ alias: 'prod', hostName: 'example.com' }], hasInclude: false }),
          }
        }
        if (url.pathname === '/api/remote/resolve-target') {
          return {
            ok: true,
            json: async () => ({ target: { ...target, alias: body.alias, remotePath: body.remotePath } }),
          }
        }
        if (url.pathname === '/api/remote/test-repo') {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              target: body.target,
              stages: [{ name: 'path', label: 'path', status: 'passed' }],
            }),
          }
        }
        if (url.pathname === '/api/remote/path-suggestions') {
          return { ok: true, json: async () => [] }
        }
        throw new Error(`Unhandled fetch URL: ${url.pathname}`)
      }),
    )

    render(
      <PrimaryWindowNavigationProvider value={navigationWith({})}>
        <OpenRemoteWorkspaceDialog open onOpenChange={vi.fn()} />
      </PrimaryWindowNavigationProvider>,
    )
    await flush()

    expect(document.activeElement).toBe(input('#remote-path'))
  })

  test('ensures the remote workspace is open before delegating activation to navigation', async () => {
    const ensureWorkspaceOpen = vi.fn(async () => ({
      ok: true as const,
      workspaceId: workspaceIdForTest(target.id),
    }))
    useReposStore.setState({ ensureWorkspaceOpen })
    const activateWorkspace = vi.fn()
    const onOpenChange = vi.fn()

    render(
      <PrimaryWindowNavigationProvider value={navigationWith({ activateWorkspace })}>
        <OpenRemoteWorkspaceDialog open onOpenChange={onOpenChange} />
      </PrimaryWindowNavigationProvider>,
    )
    await flush()

    setInputValue('#remote-ssh-host', 'prod')
    setInputValue('#remote-path', '/srv/repo')
    click('button[type="submit"]')
    await flush()

    expect(ensureWorkspaceOpen).toHaveBeenCalledWith({
      kind: 'remote',
      id: target.id,
      ref: {
        id: target.id,
        alias: 'prod',
        remotePath: '/srv/repo',
        displayName: 'prod:repo',
      },
    })
    expect(activateWorkspace).toHaveBeenCalledWith(target.id)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  test('reports post-open effect failures after opening a remote workspace', async () => {
    const ensureWorkspaceOpen = vi.fn(async () => ({
      ok: true as const,
      workspaceId: workspaceIdForTest(target.id),
      postOpenEffects: Promise.resolve([{ kind: 'recent-workspace' as const, message: 'recent write failed' }]),
    }))
    useReposStore.setState({ ensureWorkspaceOpen })

    render(
      <PrimaryWindowNavigationProvider value={navigationWith({})}>
        <OpenRemoteWorkspaceDialog open onOpenChange={vi.fn()} />
      </PrimaryWindowNavigationProvider>,
    )
    await flush()

    setInputValue('#remote-ssh-host', 'prod')
    setInputValue('#remote-path', '/srv/repo')
    click('button[type="submit"]')
    await flush()

    expect(mocks.toastError).toHaveBeenCalledWith('workspace-picker.recent-save-failed', {
      description: 'prod:repo\nrecent write failed',
    })
  })

  test('clears a previous connection error after editing the target', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = new URL(typeof input === 'string' ? input : input.toString())
        const body =
          typeof init?.body === 'string' && init.body.length > 0 ? (JSON.parse(init.body) as Record<string, any>) : {}
        if (url.pathname === '/api/remote/ssh-hosts') {
          return { ok: true, json: async () => ({ hosts: [], hasInclude: true }) }
        }
        if (url.pathname === '/api/remote/resolve-target') {
          return {
            ok: true,
            json: async () => ({ target: { ...target, alias: body.alias, remotePath: body.remotePath } }),
          }
        }
        if (url.pathname === '/api/remote/test-repo') {
          throw new Error('Permission denied')
        }
        if (url.pathname === '/api/remote/path-suggestions') {
          return { ok: true, json: async () => [] }
        }
        throw new Error(`Unhandled fetch URL: ${url.pathname}`)
      }),
    )

    render(
      <PrimaryWindowNavigationProvider value={navigationWith({})}>
        <OpenRemoteWorkspaceDialog open onOpenChange={vi.fn()} />
      </PrimaryWindowNavigationProvider>,
    )
    await flush()

    setInputValue('#remote-ssh-host', 'prod')
    setInputValue('#remote-path', '/srv/repo')
    click('button[type="submit"]')
    await flush()

    expect(document.body.textContent).toContain('Permission denied')

    setInputValue('#remote-path', '/srv/repo-next')

    expect(document.body.textContent).not.toContain('Permission denied')
  })

  test('keeps the ssh host loading error visible while editing other inputs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = new URL(typeof input === 'string' ? input : input.toString())
        if (url.pathname === '/api/remote/ssh-hosts') {
          throw new Error('SSH config unavailable')
        }
        if (url.pathname === '/api/remote/path-suggestions') {
          return { ok: true, json: async () => [] }
        }
        throw new Error(`Unhandled fetch URL: ${url.pathname}`)
      }),
    )

    render(
      <PrimaryWindowNavigationProvider value={navigationWith({})}>
        <OpenRemoteWorkspaceDialog open onOpenChange={vi.fn()} />
      </PrimaryWindowNavigationProvider>,
    )
    await flush()

    expect(document.body.textContent).toContain('SSH config unavailable')

    setInputValue('#remote-path', '/srv/repo')

    expect(document.body.textContent).toContain('SSH config unavailable')
  })
})

function navigationWith(overrides: Partial<PrimaryWindowNavigationActions>): PrimaryWindowNavigationActions {
  return {
    activateWorkspace: () => {},
    closeWorkspace: async () => ({ ok: true }),
    cycleWorkspace: () => {},
    selectRepoBranch: () => true,
    showRepoBranchEmptyWorkspacePane: () => true,
    showRepoBranchWorkspacePaneTab: () => true,
    showRepoBranchTerminalSession: () => true,
    commitWorkspacePaneRoute: () => true,
    goBack: () => {},
    goForward: () => {},
    openSettings: () => {},
    openCreateWorktree: () => {},
    ...overrides,
    currentWorkspacePaneRoute: overrides.currentWorkspacePaneRoute ?? (() => undefined),
  }
}

function render(element: ReactNode) {
  return renderInJsdom(element)
}

function input(selector: string): HTMLInputElement {
  const element = document.body.querySelector(selector)
  if (!(element instanceof HTMLInputElement)) throw new Error(`Missing input: ${selector}`)
  return element
}

function button(selector: string): HTMLButtonElement {
  const element = document.body.querySelector(selector)
  if (!(element instanceof HTMLButtonElement)) throw new Error(`Missing button: ${selector}`)
  return element
}

function setInputValue(selector: string, value: string) {
  const element = input(selector)
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
  descriptor?.set?.call(element, value)
  act(() => {
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function click(selector: string) {
  const element = button(selector)
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

function clickButtonByText(text: string) {
  const element = findButtonByText(text)
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

function findButtonByText(text: string): HTMLButtonElement {
  const element = Array.from(document.body.querySelectorAll('button')).find((item) => item.textContent?.includes(text))
  if (!(element instanceof HTMLButtonElement)) throw new Error(`Missing button text: ${text}`)
  return element
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}
