// @vitest-environment jsdom

import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { OpenRemoteRepositoryDialog } from '#/web/components/OpenRemoteRepositoryDialog.tsx'
import { MainWindowNavigationProvider, type MainWindowNavigationActions } from '#/web/main-window-navigation.tsx'
import { setRendererBridgeForTests } from '#/web/renderer-bridge.ts'
import { ELECTRON_RENDERER_CAPABILITIES, RENDERER_BRIDGE_VERSION } from '#/shared/bootstrap.ts'
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
      bridgeVersion: RENDERER_BRIDGE_VERSION,
      capabilities: [...ELECTRON_RENDERER_CAPABILITIES],
    },
    homeDir: '/Users/test',
    initialI18n: null,
    initialSettings: null,
    initialServer: { url: 'http://127.0.0.1:32100/', secret: 'secret' },
  }
  Object.defineProperty(window, 'goblinNative', {
    configurable: true,
    value: {
      runtime: {
        kind: 'electron',
        bridgeVersion: RENDERER_BRIDGE_VERSION,
        capabilities: [...ELECTRON_RENDERER_CAPABILITIES],
      },
      homeDir: '/Users/test',
      pathForFile: () => '',
      invokeRpc: async () => null,
      abortRpc: async () => true,
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
})

function navigationWith(overrides: Partial<MainWindowNavigationActions>): MainWindowNavigationActions {
  return {
    activateRepo: () => {},
    closeRepo: () => {},
    cycleRepo: () => {},
    selectRepoBranch: () => {},
    showRepoDetailTab: () => {},
    showRepoBranchDetailTab: () => {},
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

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}
