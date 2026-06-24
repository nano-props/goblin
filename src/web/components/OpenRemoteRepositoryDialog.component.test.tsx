// @vitest-environment jsdom

import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { OpenRemoteRepositoryDialog } from '#/web/components/OpenRemoteRepositoryDialog.tsx'
import { MainWindowNavigationProvider, type MainWindowNavigationActions } from '#/web/main-window-navigation.tsx'
import { setRendererBridgeForTests } from '#/web/renderer-bridge.ts'
import { ELECTRON_CLIENT_CAPABILITIES, CLIENT_BRIDGE_VERSION } from '#/shared/bootstrap.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { resetReposStore } from '#/web/stores/repos/test-utils.ts'

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const testWindow = window as unknown as { goblinNative?: unknown; __GOBLIN_BOOTSTRAP__?: unknown }

const target = {
  id: 'ssh-config://prod/srv/repo',
  alias: 'prod',
  host: 'example.com',
  user: 'alice',
  port: 22,
  remotePath: '/srv/repo',
  displayName: 'prod:repo',
} as const

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  resetReposStore()
  setRendererBridgeForTests(null)
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
      if (url.pathname === '/api/remote/test-repository') {
        return { ok: true, json: async () => ({ ok: true, target: body.target, stages: [] }) }
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
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  delete testWindow.goblinNative
  delete testWindow.__GOBLIN_BOOTSTRAP__
  setRendererBridgeForTests(null)
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

describe('OpenRemoteRepositoryDialog', () => {
  test('keeps the remote status row mounted before running a connection test', async () => {
    render(
      <MainWindowNavigationProvider value={navigationWith({})}>
        <OpenRemoteRepositoryDialog open onOpenChange={vi.fn()} />
      </MainWindowNavigationProvider>,
    )
    await flush()

    expect(document.body.querySelector('[data-slot="remote-diagnostics-status"]')).not.toBeNull()
  })

  test('renders a minimal remote status row in the initial state', async () => {
    render(
      <MainWindowNavigationProvider value={navigationWith({})}>
        <OpenRemoteRepositoryDialog open onOpenChange={vi.fn()} />
      </MainWindowNavigationProvider>,
    )
    await flush()

    expect(document.body.querySelector('[data-slot="remote-diagnostics-status"]')).not.toBeNull()
    expect(document.body.querySelector('[data-slot="dialog-status-row"]')).not.toBeNull()
    expect(document.body.textContent).toContain('repo-picker.open-remote-diagnostics-idle-detail')
    expect(document.body.textContent).not.toContain('repo-picker.open-remote-path-required')
  })

  test('updates typed values in the host and path inputs', async () => {
    render(
      <MainWindowNavigationProvider value={navigationWith({})}>
        <OpenRemoteRepositoryDialog open onOpenChange={vi.fn()} />
      </MainWindowNavigationProvider>,
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
        if (url.pathname === '/api/remote/test-repository') {
          return { ok: true, json: async () => ({ ok: true, target: body.target, stages: [] }) }
        }
        if (url.pathname === '/api/remote/path-suggestions') {
          return { ok: true, json: async () => [] }
        }
        throw new Error(`Unhandled fetch URL: ${url.pathname}`)
      }),
    )

    render(
      <MainWindowNavigationProvider value={navigationWith({})}>
        <OpenRemoteRepositoryDialog open onOpenChange={vi.fn()} />
      </MainWindowNavigationProvider>,
    )
    await flush()

    setInputValue('#remote-ssh-host', 'prod')
    setInputValue('#remote-path', '~/repo')
    clickButtonByText('repo-picker.open-remote-test-connection')
    await flush()

    expect(document.body.textContent).toContain('repo-picker.open-remote-diagnostics-ok')
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
        if (url.pathname === '/api/remote/test-repository') {
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
      <MainWindowNavigationProvider value={navigationWith({})}>
        <OpenRemoteRepositoryDialog open onOpenChange={vi.fn()} />
      </MainWindowNavigationProvider>,
    )
    await flush()

    setInputValue('#remote-ssh-host', 'prod')
    setInputValue('#remote-path', '/srv/repo')
    clickButtonByText('repo-picker.open-remote-test-connection')
    await flush()

    expect(document.body.textContent).toContain('repo-picker.open-remote-diagnostics-testing')

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
        if (url.pathname === '/api/remote/test-repository') {
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
      <MainWindowNavigationProvider value={navigationWith({})}>
        <OpenRemoteRepositoryDialog open onOpenChange={vi.fn()} />
      </MainWindowNavigationProvider>,
    )
    await flush()

    setInputValue('#remote-ssh-host', 'prod')
    setInputValue('#remote-path', '/srv/repo')
    clickButtonByText('repo-picker.open-remote-test-connection')
    await flush()

    const copyButton = findButtonByText('repo-picker.open-remote-diagnostics-copy-details')
    const row = copyButton.parentElement
    expect(row?.textContent).toContain('handshake-failed')
    expect(row?.textContent).toContain('repo-picker.open-remote-diagnostics-copy-details')
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
        if (url.pathname === '/api/remote/test-repository') {
          return { ok: true, json: async () => ({ ok: true, target: body.target, stages: [] }) }
        }
        if (url.pathname === '/api/remote/path-suggestions') {
          return { ok: true, json: async () => [] }
        }
        throw new Error(`Unhandled fetch URL: ${url.pathname}`)
      }),
    )

    render(
      <MainWindowNavigationProvider value={navigationWith({})}>
        <OpenRemoteRepositoryDialog open onOpenChange={vi.fn()} />
      </MainWindowNavigationProvider>,
    )
    await flush()

    const descriptions = document.body.querySelectorAll('[data-slot="field-description"]')
    expect(descriptions).toHaveLength(1)
  })

  test('keeps the empty remote path in a neutral state until the user types an invalid path', async () => {
    render(
      <MainWindowNavigationProvider value={navigationWith({})}>
        <OpenRemoteRepositoryDialog open onOpenChange={vi.fn()} />
      </MainWindowNavigationProvider>,
    )
    await flush()

    expect(document.body.textContent).not.toContain('repo-picker.open-remote-path-required')

    setInputValue('#remote-path', 'repo')

    expect(document.body.textContent).toContain('repo-picker.open-remote-path-absolute')
  })

  test('focuses the host alias input when include mode requires manual host entry', async () => {
    const onOpenChange = vi.fn()

    render(
      <MainWindowNavigationProvider value={navigationWith({})}>
        <OpenRemoteRepositoryDialog open onOpenChange={onOpenChange} />
      </MainWindowNavigationProvider>,
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
        if (url.pathname === '/api/remote/test-repository') {
          return { ok: true, json: async () => ({ ok: true, target: body.target, stages: [] }) }
        }
        if (url.pathname === '/api/remote/path-suggestions') {
          return { ok: true, json: async () => [] }
        }
        throw new Error(`Unhandled fetch URL: ${url.pathname}`)
      }),
    )

    render(
      <MainWindowNavigationProvider value={navigationWith({})}>
        <OpenRemoteRepositoryDialog open onOpenChange={vi.fn()} />
      </MainWindowNavigationProvider>,
    )
    await flush()

    expect(document.activeElement).toBe(input('#remote-path'))
  })

  test('ensures the remote workspace is open before delegating activation to navigation', async () => {
    const ensureWorkspaceOpen = vi.fn(async () => ({ ok: true as const, id: target.id }))
    useReposStore.setState({ ensureWorkspaceOpen })
    const activateRepo = vi.fn()
    const onOpenChange = vi.fn()

    render(
      <MainWindowNavigationProvider value={navigationWith({ activateRepo })}>
        <OpenRemoteRepositoryDialog open onOpenChange={onOpenChange} />
      </MainWindowNavigationProvider>,
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
    expect(activateRepo).toHaveBeenCalledWith(target.id)
    expect(onOpenChange).toHaveBeenCalledWith(false)
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
        if (url.pathname === '/api/remote/test-repository') {
          throw new Error('Permission denied')
        }
        if (url.pathname === '/api/remote/path-suggestions') {
          return { ok: true, json: async () => [] }
        }
        throw new Error(`Unhandled fetch URL: ${url.pathname}`)
      }),
    )

    render(
      <MainWindowNavigationProvider value={navigationWith({})}>
        <OpenRemoteRepositoryDialog open onOpenChange={vi.fn()} />
      </MainWindowNavigationProvider>,
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
      <MainWindowNavigationProvider value={navigationWith({})}>
        <OpenRemoteRepositoryDialog open onOpenChange={vi.fn()} />
      </MainWindowNavigationProvider>,
    )
    await flush()

    expect(document.body.textContent).toContain('SSH config unavailable')

    setInputValue('#remote-path', '/srv/repo')

    expect(document.body.textContent).toContain('SSH config unavailable')
  })
})

function navigationWith(overrides: Partial<MainWindowNavigationActions>): MainWindowNavigationActions {
  return {
    activateRepo: () => {},
    closeRepo: () => {},
    cycleRepo: () => {},
    selectRepoBranch: () => {},
    showRepoWorkspacePaneView: () => {},
    showRepoBranchWorkspacePaneView: () => {},
    openSettings: () => {},
    ...overrides,
  }
}

function render(element: ReactNode) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => {
    root!.render(element)
  })
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
