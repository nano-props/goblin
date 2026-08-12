// @vitest-environment jsdom

import { flushTestUpdates, renderComposableInJsdom } from '#/test-utils/render.tsx'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { WorkspaceRuntimeInvalidationEvent } from '#/shared/workspace-runtime-invalidation.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { useWorkspaceRuntimeInvalidationRefresh } from '#/web/hooks/useWorkspaceRuntimeInvalidationRefresh.ts'
import { acceptRemoteWorkspaceLifecycleSnapshot } from '#/web/stores/workspaces/remote-workspace-lifecycle-projection.ts'
import { invalidateWorkspaceRuntimes } from '#/web/workspace-runtime-query.ts'

const workspaceId = workspaceIdForTest('goblin+ssh://example/workspace')
const mocks = vi.hoisted(() => ({
  listener: null as ((event: WorkspaceRuntimeInvalidationEvent) => void) | null,
  setState: vi.fn(),
  getState: vi.fn(),
}))

vi.mock('#/web/workspace-runtime-invalidation-ingress.ts', () => ({
  subscribeWorkspaceRuntimeInvalidation(next: (event: WorkspaceRuntimeInvalidationEvent) => void) {
    mocks.listener = next
    return () => {
      mocks.listener = null
    }
  },
}))
vi.mock('#/web/stores/workspaces/store.ts', () => ({
  workspacesStore: { getState: mocks.getState, setState: mocks.setState },
}))
vi.mock('#/web/workspace-runtime-query.ts', () => ({ invalidateWorkspaceRuntimes: vi.fn() }))
vi.mock('#/web/stores/workspaces/remote-workspace-lifecycle-projection.ts', () => ({
  acceptRemoteWorkspaceLifecycleSnapshot: vi.fn(),
}))

describe('useWorkspaceRuntimeInvalidationRefresh', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listener = null
    mocks.getState.mockReturnValue({ workspaces: { [workspaceId]: { id: workspaceId } } })
  })

  test('projects lifecycle without writing capability from the runtime snapshot', async () => {
    const snapshot = { runtimes: [] }
    vi.mocked(invalidateWorkspaceRuntimes).mockResolvedValue(snapshot)
    renderComposableInJsdom(useWorkspaceRuntimeInvalidationRefresh)

    await flushTestUpdates(async () => {
      mocks.listener?.({ type: 'workspace-runtime-invalidated', workspaceId })
      await Promise.resolve()
    })

    expect(invalidateWorkspaceRuntimes).toHaveBeenCalledOnce()
    expect(acceptRemoteWorkspaceLifecycleSnapshot).toHaveBeenCalledWith(mocks.setState, mocks.getState, snapshot)
  })

  test('serializes a terminal invalidation that arrives during the connecting refresh', async () => {
    const firstSnapshot = { runtimes: [] }
    const secondSnapshot = { runtimes: [] }
    let resolveFirst!: (snapshot: typeof firstSnapshot) => void
    vi.mocked(invalidateWorkspaceRuntimes)
      .mockImplementationOnce(async () => await new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce(secondSnapshot)
    renderComposableInJsdom(useWorkspaceRuntimeInvalidationRefresh)

    await flushTestUpdates(async () => {
      mocks.listener?.({ type: 'workspace-runtime-invalidated', workspaceId })
      mocks.listener?.({ type: 'workspace-runtime-invalidated', workspaceId })
      await Promise.resolve()
    })
    expect(invalidateWorkspaceRuntimes).toHaveBeenCalledTimes(2)

    resolveFirst(firstSnapshot)
    await vi.waitFor(() => expect(acceptRemoteWorkspaceLifecycleSnapshot).toHaveBeenCalledTimes(2))
    expect(acceptRemoteWorkspaceLifecycleSnapshot).toHaveBeenCalledTimes(2)
  })
})
