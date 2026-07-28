// @vitest-environment jsdom
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { act, waitFor } from '@testing-library/react'
import { mockFetch } from '#/test-utils/fetch-mock.ts'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { RepoCloneDialog } from '#/web/components/RepoCloneDialog.tsx'
import { AppNavigationProvider, type AppNavigationActions } from '#/web/app-navigation.tsx'
import { appNavigationActionsForTest } from '#/web/test-utils/app-navigation.ts'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import { ELECTRON_CLIENT_CAPABILITIES, CLIENT_BRIDGE_VERSION } from '#/shared/bootstrap.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { resetWorkspacesStore } from '#/web/test-utils/repo-store.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { currentNativeBridge } from '#/web/test-utils/current-native-bridge.ts'

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
  resetWorkspacesStore()
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
    value: currentNativeBridge(),
  })
})

afterEach(() => {
  delete testWindow.goblinNative
  delete testWindow.__GOBLIN_BOOTSTRAP__
  setClientBridgeForTests(null)
})

describe('RepoCloneDialog', () => {
  test('ensures the cloned workspace is open before delegating activation to navigation', async () => {
    const ensureWorkspaceOpen = vi.fn(async () => ({
      ok: true as const,
      workspaceId: workspaceIdForTest('goblin+file:///tmp/cloned-repo'),
    }))
    useWorkspacesStore.setState({ ensureWorkspaceOpen })
    const activateWorkspace = vi.fn()
    const onOpenChange = vi.fn()

    renderInJsdom(
      <AppNavigationProvider value={navigationWith({ activateWorkspace })}>
        <RepoCloneDialog open onOpenChange={onOpenChange} />
      </AppNavigationProvider>,
    )

    setInputValue('#clone-url', 'https://example.com/repo.git')
    setInputValue('#clone-directory-name', 'repo')
    click('button[type="submit"]')
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))

    expect(ensureWorkspaceOpen).toHaveBeenCalledWith('/tmp/cloned-repo')
    expect(activateWorkspace).toHaveBeenCalledWith('goblin+file:///tmp/cloned-repo')
    expect(ensureWorkspaceOpen.mock.invocationCallOrder[0]!).toBeLessThan(
      activateWorkspace.mock.invocationCallOrder[0]!,
    )
    expect(activateWorkspace.mock.invocationCallOrder[0]!).toBeLessThan(onOpenChange.mock.invocationCallOrder[0]!)
  })

  test('reports post-open effect failures after opening the cloned workspace', async () => {
    const ensureWorkspaceOpen = vi.fn(async () => ({
      ok: true as const,
      workspaceId: workspaceIdForTest('goblin+file:///tmp/cloned-repo'),
      postOpenEffects: Promise.resolve([{ kind: 'recent-workspace' as const, message: 'recent write failed' }]),
    }))
    useWorkspacesStore.setState({ ensureWorkspaceOpen })

    renderInJsdom(
      <AppNavigationProvider value={navigationWith({})}>
        <RepoCloneDialog open onOpenChange={vi.fn()} />
      </AppNavigationProvider>,
    )

    setInputValue('#clone-url', 'https://example.com/repo.git')
    setInputValue('#clone-directory-name', 'repo')
    click('button[type="submit"]')

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('workspace-picker.recent-save-failed', {
        description: '/tmp/cloned-repo\nrecent write failed',
      })
    })
  })
})

function navigationWith(overrides: Partial<Pick<AppNavigationActions, 'activateWorkspace'>>): AppNavigationActions {
  return appNavigationActionsForTest({
    activateWorkspace: () => {},
    ...overrides,
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
