// @vitest-environment jsdom
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

import { waitFor } from '@testing-library/vue'
import { flushTestUpdates } from '#/test-utils/render.tsx'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { WorkspaceOpenDialog } from '#/web/components/WorkspaceOpenDialog.tsx'
import type { AppNavigationActions } from '#/web/app-navigation-actions.ts'
import { AppNavigationProvider } from '#/web/app-navigation.tsx'
import { appNavigationActionsForTest } from '#/web/test-utils/app-navigation.ts'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import { hostInfoStore } from '#/web/stores/host-info.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import type { WorkspaceMembershipActions } from '#/web/stores/workspaces/types.ts'
import { resetWorkspacesStore } from '#/web/test-utils/repo-store.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { currentNativeBridge } from '#/web/test-utils/current-native-bridge.ts'
import { CLIENT_BRIDGE_VERSION, ELECTRON_CLIENT_CAPABILITIES } from '#/shared/bootstrap.ts'

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
}))

vi.mock('vue-sonner', () => ({
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
  // endpoint and the client-side `hostInfoStore` — seed
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
  hostInfoStore.setState({
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
    const openWorkspaceMembership = vi.fn(async () => ({
      ok: true as const,
      workspaceId: workspaceIdForTest('goblin+file:///Users/tester/Developer/repo'),
    }))
    const activateWorkspace = vi.fn()
    const onOpenChange = vi.fn()
    await renderAndSubmitWorkspaceOpen(openWorkspaceMembership, activateWorkspace, onOpenChange)
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))

    expect(openWorkspaceMembership).toHaveBeenCalledWith('/Users/tester/Developer/repo')
    expect(activateWorkspace).toHaveBeenCalledWith('goblin+file:///Users/tester/Developer/repo')
    expect(openWorkspaceMembership.mock.invocationCallOrder[0]!).toBeLessThan(
      activateWorkspace.mock.invocationCallOrder[0]!,
    )
    expect(activateWorkspace.mock.invocationCallOrder[0]!).toBeLessThan(onOpenChange.mock.invocationCallOrder[0]!)
  })

  test('does not activate a workspace that finishes opening after a controlled close', async () => {
    const opening = Promise.withResolvers<{
      ok: true
      workspaceId: ReturnType<typeof workspaceIdForTest>
    }>()
    const openWorkspaceMembership = vi.fn(() => opening.promise)
    const activateWorkspace = vi.fn()
    const onOpenChange = vi.fn()
    const { navigation, rerender } = await renderAndSubmitWorkspaceOpen(
      openWorkspaceMembership,
      activateWorkspace,
      onOpenChange,
    )
    await waitFor(() => expect(openWorkspaceMembership).toHaveBeenCalledWith('/Users/tester/Developer/repo'))

    await rerender(
      <AppNavigationProvider value={navigation}>
        <WorkspaceOpenDialog open={false} onOpenChange={onOpenChange} />
      </AppNavigationProvider>,
    )
    await flushTestUpdates(async () => {
      opening.resolve({
        ok: true,
        workspaceId: workspaceIdForTest('goblin+file:///Users/tester/Developer/repo'),
      })
      await opening.promise
    })

    expect(openWorkspaceMembership).toHaveBeenCalledTimes(1)
    expect(activateWorkspace).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  test('keeps workspace-open success when activation presentation fails', async () => {
    const openWorkspaceMembership = vi.fn(async () => ({
      ok: true as const,
      workspaceId: workspaceIdForTest('goblin+file:///Users/tester/Developer/repo'),
    }))
    const activateWorkspace = vi.fn(() => {
      throw new Error('workspace activation crashed')
    })
    const onOpenChange = vi.fn()
    await renderAndSubmitWorkspaceOpen(openWorkspaceMembership, activateWorkspace, onOpenChange)
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))

    expect(openWorkspaceMembership).toHaveBeenCalledOnce()
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

async function renderAndSubmitWorkspaceOpen(
  openWorkspaceMembership: WorkspaceMembershipActions['openWorkspaceMembership'],
  activateWorkspace: AppNavigationActions['activateWorkspace'],
  onOpenChange: (open: boolean) => void,
): Promise<{ navigation: AppNavigationActions; rerender: ReturnType<typeof renderInJsdom>['rerender'] }> {
  workspacesStore.setState({ openWorkspaceMembership })
  const navigation = navigationWith({ activateWorkspace })
  const { rerender } = renderInJsdom(
    <AppNavigationProvider value={navigation}>
      <WorkspaceOpenDialog open onOpenChange={onOpenChange} />
    </AppNavigationProvider>,
  )
  await setInputValue('#open-workspace-path', '~/Developer/repo')
  await click('button[type="submit"]')
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

async function setInputValue(selector: string, value: string): Promise<void> {
  await flushTestUpdates(() => {})
  const element = input(selector)
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
  descriptor?.set?.call(element, value)
  await flushTestUpdates(() => {
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

async function click(selector: string): Promise<void> {
  await flushTestUpdates(() => {})
  const element = button(selector)
  await flushTestUpdates(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}
