// @vitest-environment jsdom
import { act } from '@testing-library/react'
import { mockFetch } from '#/test-utils/fetch-mock.ts'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { RepoCloneDialog } from '#/web/components/RepoCloneDialog.tsx'
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
  toastSuccess: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}))

const testWindow = window as unknown as { goblinNative?: unknown; __GOBLIN_BOOTSTRAP__?: unknown }
const fetchMock = mockFetch(async (input: RequestInfo | URL) => {
  const url = new URL(typeof input === 'string' ? input : input.toString())
  if (url.pathname === '/api/repo/clone') {
    return {
      ok: true,
      json: async () => ({ ok: true, message: 'ok', path: '/tmp/cloned-repo' }),
    }
  }
  throw new Error(`Unhandled fetch URL: ${url.pathname}`)
})

beforeEach(() => {
  vi.clearAllMocks()
  resetReposStore()
  setClientBridgeForTests(null)
  fetchMock.mockClear()
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

describe('RepoCloneDialog', () => {
  test('ensures the cloned workspace is open before delegating activation to navigation', async () => {
    const ensureWorkspaceOpen = vi.fn(async () => ({ ok: true as const, id: '/tmp/cloned-repo' }))
    useReposStore.setState({ ensureWorkspaceOpen })
    const activateRepo = vi.fn()
    const onOpenChange = vi.fn()

    renderInJsdom(
      <PrimaryWindowNavigationProvider value={navigationWith({ activateRepo })}>
        <RepoCloneDialog open onOpenChange={onOpenChange} />
      </PrimaryWindowNavigationProvider>,
    )

    setInputValue('#clone-url', 'https://example.com/repo.git')
    setInputValue('#clone-directory-name', 'repo')
    click('button[type="submit"]')
    await flush()

    expect(ensureWorkspaceOpen).toHaveBeenCalledWith('/tmp/cloned-repo')
    expect(activateRepo).toHaveBeenCalledWith('/tmp/cloned-repo')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  test('reports post-open effect failures after opening the cloned workspace', async () => {
    const ensureWorkspaceOpen = vi.fn(async () => ({
      ok: true as const,
      id: '/tmp/cloned-repo',
      postOpenEffects: Promise.resolve([{ kind: 'recent-repo' as const, message: 'recent write failed' }]),
    }))
    useReposStore.setState({ ensureWorkspaceOpen })

    renderInJsdom(
      <PrimaryWindowNavigationProvider value={navigationWith({})}>
        <RepoCloneDialog open onOpenChange={vi.fn()} />
      </PrimaryWindowNavigationProvider>,
    )

    setInputValue('#clone-url', 'https://example.com/repo.git')
    setInputValue('#clone-directory-name', 'repo')
    click('button[type="submit"]')
    await flush()

    expect(mocks.toastError).toHaveBeenCalledWith('repo-picker.recent-save-failed', {
      description: '/tmp/cloned-repo\nrecent write failed',
    })
  })
})

function navigationWith(overrides: Partial<PrimaryWindowNavigationActions>): PrimaryWindowNavigationActions {
  return {
    activateRepo: () => {},
    closeRepo: () => {},
    cycleRepo: () => {},
    selectRepoBranch: () => {},
    showRepoBranchWorkspacePaneTab: () => {},
    showRepoBranchTerminalSession: () => {},
    goBack: () => {},
    goForward: () => {},
    openSettings: () => {},
    openCreateWorktree: () => {},
    ...overrides,
  }
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
  })
}
