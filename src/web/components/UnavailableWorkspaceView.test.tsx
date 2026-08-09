// @vitest-environment jsdom

import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { normalizeRemoteTarget } from '#/shared/remote-workspace.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { UnavailableWorkspaceView } from '#/web/components/UnavailableWorkspaceView.tsx'
import { runWorkspaceRefresh } from '#/web/stores/workspaces/workspace-refresh-command.ts'
import { acceptWorkspaceProbeState } from '#/web/stores/workspaces/workspace-guards.ts'
import { emptyWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { resetWorkspacesStore } from '#/web/test-utils/repo-store.ts'

vi.mock('#/web/app-navigation.tsx', () => ({
  useAppNavigation: () => ({
    closeWorkspace: vi.fn(async () => ({ ok: true })),
    openSettings: vi.fn(),
  }),
}))
vi.mock('#/web/stores/workspaces/workspace-refresh-command.ts', () => ({
  runWorkspaceRefresh: vi.fn(async () => ({ ok: true })),
}))

const localWorkspaceId = workspaceIdForTest('goblin+file:///workspace')
const remoteWorkspaceId = workspaceIdForTest('goblin+ssh://example/workspace')

describe('UnavailableWorkspaceView Retry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetWorkspacesStore()
  })

  afterEach(() => vi.restoreAllMocks())

  test('restarts the remote lifecycle through the existing store action', async () => {
    const user = userEvent.setup()
    const workspace = emptyWorkspace(remoteWorkspaceId, 'workspace-runtime-remote')
    if (workspace.admission.kind !== 'remote') throw new Error('expected remote admission')
    workspace.admission.lifecycle = { kind: 'failed', reason: 'unreachable' }
    const retry = vi.spyOn(workspacesStore.getState(), 'retryRemoteWorkspaceConnection').mockResolvedValue({ ok: true })
    workspacesStore.setState({
      workspaces: { [remoteWorkspaceId]: workspace },
      workspaceOrder: [remoteWorkspaceId],
    })

    const { getByText } = renderInJsdom(<UnavailableWorkspaceView workspace={workspace} />)
    await user.click(getByText('workspace-unavailable.retry'))

    await vi.waitFor(() => expect(retry).toHaveBeenCalledWith(remoteWorkspaceId))
    expect(runWorkspaceRefresh).not.toHaveBeenCalled()
  })

  test('submits repeated Retry clicks to the server-owned lifecycle admission', async () => {
    const user = userEvent.setup()
    const workspace = emptyWorkspace(remoteWorkspaceId, 'workspace-runtime-remote')
    if (workspace.admission.kind !== 'remote') throw new Error('expected remote admission')
    workspace.admission.lifecycle = { kind: 'failed', reason: 'unreachable' }
    const firstRetry = Promise.withResolvers<{ ok: true }>()
    const retry = vi
      .spyOn(workspacesStore.getState(), 'retryRemoteWorkspaceConnection')
      .mockReturnValueOnce(firstRetry.promise)
      .mockResolvedValueOnce({ ok: true })
    workspacesStore.setState({
      workspaces: { [remoteWorkspaceId]: workspace },
      workspaceOrder: [remoteWorkspaceId],
    })

    const { getByText } = renderInJsdom(<UnavailableWorkspaceView workspace={workspace} />)
    const retryButton = getByText('workspace-unavailable.retry')
    await user.click(retryButton)
    await user.click(retryButton)

    await vi.waitFor(() => expect(retry).toHaveBeenCalledTimes(2))
    expect(retry).toHaveBeenNthCalledWith(1, remoteWorkspaceId)
    expect(retry).toHaveBeenNthCalledWith(2, remoteWorkspaceId)
    firstRetry.resolve({ ok: true })
  })

  test('keeps local recovery on the capability Refresh command', async () => {
    const user = userEvent.setup()
    const workspace = emptyWorkspace(localWorkspaceId, 'workspace-runtime-local')
    acceptWorkspaceProbeState(workspace, {
      status: 'unavailable',
      reason: 'error.workspace-path-not-found',
    })
    const retry = vi.spyOn(workspacesStore.getState(), 'retryRemoteWorkspaceConnection').mockResolvedValue({ ok: true })
    workspacesStore.setState({
      workspaces: { [localWorkspaceId]: workspace },
      workspaceOrder: [localWorkspaceId],
    })

    const { getByText } = renderInJsdom(<UnavailableWorkspaceView workspace={workspace} />)
    await user.click(getByText('workspace-unavailable.retry'))

    await vi.waitFor(() =>
      expect(runWorkspaceRefresh).toHaveBeenCalledWith(
        { get: workspacesStore.getState, set: workspacesStore.setState },
        localWorkspaceId,
        { workspaceRuntimeId: 'workspace-runtime-local' },
      ),
    )
    expect(retry).not.toHaveBeenCalled()
  })

  test('uses capability Refresh when a connected remote has a capability failure', async () => {
    const user = userEvent.setup()
    const workspace = emptyWorkspace(remoteWorkspaceId, 'workspace-runtime-connected-remote')
    if (workspace.admission.kind !== 'remote') throw new Error('expected remote admission')
    const target = normalizeRemoteTarget({
      alias: 'example',
      host: 'example.test',
      user: 'developer',
      port: 22,
      remotePath: '/workspace',
    })
    if (!target) throw new Error('expected remote target')
    workspace.admission.lifecycle = { kind: 'ready', target }
    acceptWorkspaceProbeState(workspace, {
      status: 'unavailable',
      reason: 'error.workspace-transport-unavailable',
    })
    const retry = vi.spyOn(workspacesStore.getState(), 'retryRemoteWorkspaceConnection').mockResolvedValue({ ok: true })
    workspacesStore.setState({
      workspaces: { [remoteWorkspaceId]: workspace },
      workspaceOrder: [remoteWorkspaceId],
    })

    const { getByText } = renderInJsdom(<UnavailableWorkspaceView workspace={workspace} />)
    await user.click(getByText('workspace-unavailable.retry'))

    await vi.waitFor(() => expect(runWorkspaceRefresh).toHaveBeenCalledOnce())
    expect(retry).not.toHaveBeenCalled()
  })
})
