// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import type { WorkspaceRuntimeInvalidationEvent } from '#/shared/workspace-runtime-invalidation.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { useWorkspaceRuntimeInvalidationRefresh } from '#/web/hooks/useWorkspaceRuntimeInvalidationRefresh.ts'
import { acceptRemoteWorkspaceLifecycleSnapshot } from '#/web/stores/workspaces/remote-workspace-lifecycle-projection.ts'
import { acceptWorkspaceProbeSnapshot } from '#/web/stores/workspaces/workspace-probe-projection.ts'
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
  useWorkspacesStore: { getState: mocks.getState, setState: mocks.setState },
}))
vi.mock('#/web/workspace-runtime-query.ts', () => ({ invalidateWorkspaceRuntimes: vi.fn() }))
vi.mock('#/web/stores/workspaces/remote-workspace-lifecycle-projection.ts', () => ({
  acceptRemoteWorkspaceLifecycleSnapshot: vi.fn(),
}))
vi.mock('#/web/stores/workspaces/workspace-probe-projection.ts', () => ({
  acceptWorkspaceProbeSnapshot: vi.fn(),
}))

function Harness() {
  useWorkspaceRuntimeInvalidationRefresh()
  return null
}

describe('useWorkspaceRuntimeInvalidationRefresh', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listener = null
    mocks.getState.mockReturnValue({ workspaces: { [workspaceId]: { id: workspaceId } } })
  })

  test('projects lifecycle and capability state from one runtime snapshot', async () => {
    const snapshot = { runtimes: [] }
    vi.mocked(invalidateWorkspaceRuntimes).mockResolvedValue(snapshot)
    renderInJsdom(<Harness />)

    await act(async () => {
      mocks.listener?.({ type: 'workspace-runtime-invalidated', workspaceId })
      await Promise.resolve()
    })

    expect(invalidateWorkspaceRuntimes).toHaveBeenCalledOnce()
    expect(acceptRemoteWorkspaceLifecycleSnapshot).toHaveBeenCalledWith(mocks.setState, mocks.getState, snapshot)
    expect(acceptWorkspaceProbeSnapshot).toHaveBeenCalledWith(mocks.setState, mocks.getState, snapshot)
  })

  test('serializes a terminal invalidation that arrives during the connecting refresh', async () => {
    const firstSnapshot = { runtimes: [] }
    const secondSnapshot = { runtimes: [] }
    let resolveFirst!: (snapshot: typeof firstSnapshot) => void
    vi.mocked(invalidateWorkspaceRuntimes)
      .mockImplementationOnce(async () => await new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce(secondSnapshot)
    renderInJsdom(<Harness />)

    await act(async () => {
      mocks.listener?.({ type: 'workspace-runtime-invalidated', workspaceId })
      mocks.listener?.({ type: 'workspace-runtime-invalidated', workspaceId })
      await Promise.resolve()
    })
    expect(invalidateWorkspaceRuntimes).toHaveBeenCalledTimes(2)

    resolveFirst(firstSnapshot)
    await vi.waitFor(() => expect(acceptRemoteWorkspaceLifecycleSnapshot).toHaveBeenCalledTimes(2))
    expect(acceptRemoteWorkspaceLifecycleSnapshot).toHaveBeenCalledTimes(2)
    expect(acceptWorkspaceProbeSnapshot).toHaveBeenCalledTimes(2)
  })
})
