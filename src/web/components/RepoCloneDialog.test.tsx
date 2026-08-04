// @vitest-environment jsdom
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { act, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { mockFetch } from '#/test-utils/fetch-mock.ts'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { RepoCloneDialog } from '#/web/components/RepoCloneDialog.tsx'
import { AppNavigationProvider, type AppNavigationActions } from '#/web/app-navigation.tsx'
import { appNavigationActionsForTest } from '#/web/test-utils/app-navigation.ts'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import { ELECTRON_CLIENT_CAPABILITIES, CLIENT_BRIDGE_VERSION } from '#/shared/bootstrap.ts'
import { useHostInfoStore } from '#/web/stores/host-info.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { resetWorkspacesStore } from '#/web/test-utils/repo-store.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { currentNativeBridge } from '#/web/test-utils/current-native-bridge.ts'

const mocks = vi.hoisted(() => ({
  loggerWarn: vi.fn(),
  t: vi.fn((key: string) => key),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock('#/web/stores/i18n.ts', () => ({
  useT: () => mocks.t,
}))

vi.mock('#/web/logger.ts', () => ({
  sessionLog: { warn: mocks.loggerWarn },
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
  mocks.loggerWarn.mockImplementation(() => {})
  mocks.t.mockImplementation((key: string) => key)
  mocks.toastError.mockImplementation(() => {})
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
  useHostInfoStore.setState({
    snapshot: { homeDir: '/Users/tester', platform: 'darwin', hostname: 'test', pid: 1 },
    status: 'ready',
    error: null,
  })
})

afterEach(() => {
  delete testWindow.goblinNative
  delete testWindow.__GOBLIN_BOOTSTRAP__
  setClientBridgeForTests(null)
})

describe('RepoCloneDialog', () => {
  test('forwards the exact clone payload and aborts the fetch when cancelled', async () => {
    const user = userEvent.setup()
    let requestSignal: AbortSignal | undefined
    fetchMock.mockImplementationOnce((_url, init) => {
      requestSignal = (init as RequestInit | undefined)?.signal ?? undefined
      return new Promise((_resolve, reject) => {
        requestSignal?.addEventListener('abort', () => reject(requestSignal?.reason), { once: true })
      })
    })
    const onOpenChange = vi.fn()

    renderInJsdom(
      <AppNavigationProvider value={navigationWith({})}>
        <RepoCloneDialog open onOpenChange={onOpenChange} />
      </AppNavigationProvider>,
    )

    setInputValue('#clone-url', 'https://example.com/repo.git')
    setInputValue('#clone-directory-name', 'repo')
    click('button[type="submit"]')

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
    expect(requestInit?.body).toEqual(expect.any(String))
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      url: 'https://example.com/repo.git',
      parentPath: '/Users/tester/Developer',
      directoryName: 'repo',
    })
    expect(requestSignal?.aborted).toBe(false)

    await user.click(screen.getByRole('button', { name: 'dialog.cancel' }))

    await waitFor(() => {
      expect(requestSignal?.aborted).toBe(true)
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })

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

  test('does not activate or report a workspace that finishes opening after cancellation', async () => {
    const user = userEvent.setup()
    const opening = Promise.withResolvers<{
      ok: true
      workspaceId: ReturnType<typeof workspaceIdForTest>
    }>()
    const ensureWorkspaceOpen = vi.fn(() => opening.promise)
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
    await waitFor(() => expect(ensureWorkspaceOpen).toHaveBeenCalledWith('/tmp/cloned-repo'))

    await user.click(screen.getByRole('button', { name: 'dialog.cancel' }))
    expect(onOpenChange).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)

    await act(async () => {
      opening.resolve({
        ok: true,
        workspaceId: workspaceIdForTest('goblin+file:///tmp/cloned-repo'),
      })
      await opening.promise
    })

    expect(ensureWorkspaceOpen).toHaveBeenCalledTimes(1)
    expect(activateWorkspace).not.toHaveBeenCalled()
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
    expect(mocks.toastError).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledTimes(1)
  })

  test('does not activate or report a workspace that finishes opening after a controlled close', async () => {
    const opening = Promise.withResolvers<{
      ok: true
      workspaceId: ReturnType<typeof workspaceIdForTest>
    }>()
    const ensureWorkspaceOpen = vi.fn(() => opening.promise)
    useWorkspacesStore.setState({ ensureWorkspaceOpen })
    const activateWorkspace = vi.fn()
    const navigation = navigationWith({ activateWorkspace })
    const onOpenChange = vi.fn()

    const { rerender } = renderInJsdom(
      <AppNavigationProvider value={navigation}>
        <RepoCloneDialog open onOpenChange={onOpenChange} />
      </AppNavigationProvider>,
    )

    setInputValue('#clone-url', 'https://example.com/repo.git')
    setInputValue('#clone-directory-name', 'repo')
    click('button[type="submit"]')
    await waitFor(() => expect(ensureWorkspaceOpen).toHaveBeenCalledWith('/tmp/cloned-repo'))

    rerender(
      <AppNavigationProvider value={navigation}>
        <RepoCloneDialog open={false} onOpenChange={onOpenChange} />
      </AppNavigationProvider>,
    )
    await act(async () => {
      opening.resolve({
        ok: true,
        workspaceId: workspaceIdForTest('goblin+file:///tmp/cloned-repo'),
      })
      await opening.promise
    })

    expect(ensureWorkspaceOpen).toHaveBeenCalledTimes(1)
    expect(activateWorkspace).not.toHaveBeenCalled()
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  test('preserves clone success when the cloned workspace cannot be opened', async () => {
    const ensureWorkspaceOpen = vi.fn(async () => ({
      ok: false as const,
      message: 'error.workspace-open-failed',
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
    expect(activateWorkspace).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith('drop.open-failed', {
      description: '/tmp/cloned-repo\nerror.workspace-open-failed',
    })
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('preserves clone success when opening the cloned workspace throws', async () => {
    const ensureWorkspaceOpen = vi.fn(async () => {
      throw new Error('workspace open crashed')
    })
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
    expect(activateWorkspace).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith('workspace-picker.clone-open-uncertain', {
      description: '/tmp/cloned-repo\nworkspace open crashed',
    })
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('preserves a definite workspace-open failure when translating its message throws', async () => {
    const ensureWorkspaceOpen = vi.fn(async () => ({
      ok: false as const,
      message: 'error.workspace-open-failed',
    }))
    useWorkspacesStore.setState({ ensureWorkspaceOpen })
    mocks.t.mockImplementation((key: string) => {
      if (key === 'error.workspace-open-failed') throw new Error('translation crashed')
      return key
    })
    const onOpenChange = vi.fn()

    renderInJsdom(
      <AppNavigationProvider value={navigationWith({})}>
        <RepoCloneDialog open onOpenChange={onOpenChange} />
      </AppNavigationProvider>,
    )

    setInputValue('#clone-url', 'https://example.com/repo.git')
    setInputValue('#clone-directory-name', 'repo')
    click('button[type="submit"]')
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))

    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      'failed to report post-clone workflow failure',
      expect.objectContaining({ kind: 'open-failed' }),
    )
    expect(mocks.toastError).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('preserves clone success when failure projection and logging both throw', async () => {
    const ensureWorkspaceOpen = vi.fn(async () => ({
      ok: false as const,
      message: 'error.workspace-open-failed',
    }))
    useWorkspacesStore.setState({ ensureWorkspaceOpen })
    mocks.toastError.mockImplementation(() => {
      throw new Error('toast crashed')
    })
    mocks.loggerWarn.mockImplementation(() => {
      throw new Error('logger crashed')
    })
    const onOpenChange = vi.fn()

    renderInJsdom(
      <AppNavigationProvider value={navigationWith({})}>
        <RepoCloneDialog open onOpenChange={onOpenChange} />
      </AppNavigationProvider>,
    )

    setInputValue('#clone-url', 'https://example.com/repo.git')
    setInputValue('#clone-directory-name', 'repo')
    click('button[type="submit"]')
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))

    expect(mocks.toastError).toHaveBeenCalledWith('drop.open-failed', {
      description: '/tmp/cloned-repo\nerror.workspace-open-failed',
    })
    expect(mocks.loggerWarn).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('preserves clone and workspace-open success when presentation throws', async () => {
    const ensureWorkspaceOpen = vi.fn(async () => ({
      ok: true as const,
      workspaceId: workspaceIdForTest('goblin+file:///tmp/cloned-repo'),
    }))
    useWorkspacesStore.setState({ ensureWorkspaceOpen })
    const activateWorkspace = vi.fn(() => {
      throw new Error('workspace presentation crashed')
    })
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
    expect(mocks.toastError).toHaveBeenCalledWith('workspace-picker.clone-presentation-failed', {
      description: '/tmp/cloned-repo\nworkspace presentation crashed',
    })
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
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
