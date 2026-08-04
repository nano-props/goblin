// @vitest-environment jsdom
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

import { act, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { WorkspaceOpenDialog } from '#/web/components/WorkspaceOpenDialog.tsx'
import { AppNavigationProvider, type AppNavigationActions } from '#/web/app-navigation.tsx'
import { appNavigationActionsForTest } from '#/web/test-utils/app-navigation.ts'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import { useHostInfoStore } from '#/web/stores/host-info.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import type { WorkspaceMembershipActions } from '#/web/stores/workspaces/types.ts'
import { resetWorkspacesStore } from '#/web/test-utils/repo-store.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { currentNativeBridge } from '#/web/test-utils/current-native-bridge.ts'
import { CLIENT_BRIDGE_VERSION, ELECTRON_CLIENT_CAPABILITIES } from '#/shared/bootstrap.ts'

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { error: mocks.toastError },
}))

const testWindow = window as unknown as {
  goblinNative?: unknown
  __GOBLIN_BOOTSTRAP__?: unknown
}

beforeEach(() => {
  vi.clearAllMocks()
  resetWorkspacesStore()
  setClientBridgeForTests(null)
  // The bootstrap is the source of truth for the tiny client
  // payload (runtime kind, initial server handoff). The preload
  // only exposes IPC. Host info (homeDir, platform) used to live
  // in the bootstrap; it now lives on the public `/api/host`
  // endpoint and the client-side `useHostInfoStore` — seed
  // that store directly so the dialog's tilde resolution and
  // platform branching work without mocking `fetch`.
  Object.defineProperty(window, '__GOBLIN_BOOTSTRAP__', {
    configurable: true,
    value: {
      runtime: {
        kind: 'electron',
        bridgeVersion: CLIENT_BRIDGE_VERSION,
        capabilities: ELECTRON_CLIENT_CAPABILITIES,
      },
      initialServer: null,
    },
  })
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

describe('WorkspaceOpenDialog', () => {
  test('ensures the workspace is open before delegating activation to navigation', async () => {
    const ensureWorkspaceOpen = vi.fn(async () => ({
      ok: true as const,
      workspaceId: workspaceIdForTest('goblin+file:///Users/tester/Developer/repo'),
    }))
    const activateWorkspace = vi.fn()
    const onOpenChange = vi.fn()
    renderAndSubmitWorkspaceOpen(ensureWorkspaceOpen, activateWorkspace, onOpenChange)
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))

    expect(ensureWorkspaceOpen).toHaveBeenCalledWith('/Users/tester/Developer/repo')
    expect(activateWorkspace).toHaveBeenCalledWith('goblin+file:///Users/tester/Developer/repo')
    expect(ensureWorkspaceOpen.mock.invocationCallOrder[0]!).toBeLessThan(
      activateWorkspace.mock.invocationCallOrder[0]!,
    )
    expect(activateWorkspace.mock.invocationCallOrder[0]!).toBeLessThan(onOpenChange.mock.invocationCallOrder[0]!)
  })

  test('does not activate a workspace that finishes opening after a controlled close', async () => {
    const opening = Promise.withResolvers<{
      ok: true
      workspaceId: ReturnType<typeof workspaceIdForTest>
    }>()
    const ensureWorkspaceOpen = vi.fn(() => opening.promise)
    const activateWorkspace = vi.fn()
    const onOpenChange = vi.fn()
    const { navigation, rerender } = renderAndSubmitWorkspaceOpen(ensureWorkspaceOpen, activateWorkspace, onOpenChange)
    await waitFor(() => expect(ensureWorkspaceOpen).toHaveBeenCalledWith('/Users/tester/Developer/repo'))

    rerender(
      <AppNavigationProvider value={navigation}>
        <WorkspaceOpenDialog open={false} onOpenChange={onOpenChange} />
      </AppNavigationProvider>,
    )
    await act(async () => {
      opening.resolve({
        ok: true,
        workspaceId: workspaceIdForTest('goblin+file:///Users/tester/Developer/repo'),
      })
      await opening.promise
    })

    expect(ensureWorkspaceOpen).toHaveBeenCalledTimes(1)
    expect(activateWorkspace).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  test('keeps workspace-open success when activation presentation fails', async () => {
    const ensureWorkspaceOpen = vi.fn(async () => ({
      ok: true as const,
      workspaceId: workspaceIdForTest('goblin+file:///Users/tester/Developer/repo'),
    }))
    const activateWorkspace = vi.fn(() => {
      throw new Error('workspace activation crashed')
    })
    const onOpenChange = vi.fn()
    renderAndSubmitWorkspaceOpen(ensureWorkspaceOpen, activateWorkspace, onOpenChange)
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))

    expect(ensureWorkspaceOpen).toHaveBeenCalledOnce()
    expect(activateWorkspace).toHaveBeenCalledOnce()
    expect(mocks.toastError).toHaveBeenCalledWith('workspace-picker.open-presentation-failed', {
      description: 'workspace activation crashed',
    })
  })
})

function navigationWith(overrides: Partial<Pick<AppNavigationActions, 'activateWorkspace'>>): AppNavigationActions {
  return appNavigationActionsForTest({
    activateWorkspace: () => {},
    ...overrides,
  })
}

function renderAndSubmitWorkspaceOpen(
  ensureWorkspaceOpen: WorkspaceMembershipActions['ensureWorkspaceOpen'],
  activateWorkspace: AppNavigationActions['activateWorkspace'],
  onOpenChange: (open: boolean) => void,
) {
  useWorkspacesStore.setState({ ensureWorkspaceOpen })
  const navigation = navigationWith({ activateWorkspace })
  const { rerender } = renderInJsdom(
    <AppNavigationProvider value={navigation}>
      <WorkspaceOpenDialog open onOpenChange={onOpenChange} />
    </AppNavigationProvider>,
  )
  setInputValue('#open-workspace-path', '~/Developer/repo')
  click('button[type="submit"]')
  return { navigation, rerender }
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
