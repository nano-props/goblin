import { beforeEach, describe, expect, test } from 'vitest'
import { normalizeRemoteTarget } from '#/shared/remote-workspace.ts'
import { emptyWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import {
  acceptRemoteWorkspaceLifecycleProjection,
  acceptRemoteWorkspaceLifecycleSnapshot,
} from '#/web/stores/workspaces/remote-workspace-lifecycle-projection.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { workspaceRemoteAdmission } from '#/web/workspace-capability.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const repoRoot = workspaceIdForTest('goblin+ssh://example/repo')
const workspaceRuntimeId = 'repo-runtime-test-1'
const target = normalizeRemoteTarget({
  alias: 'example',
  host: 'example.test',
  user: 'developer',
  port: 22,
  remotePath: '/repo',
})!

describe('remote lifecycle projection acceptance', () => {
  beforeEach(() => {
    const repo = emptyWorkspace(repoRoot, 'repo', workspaceRuntimeId)
    useWorkspacesStore.setState({ workspaces: { [repoRoot]: repo }, workspaceOrder: [repoRoot] })
  })

  test('accepts connecting then terminal within one server attempt', () => {
    expect(accept({ kind: 'connecting', attemptId: 2 })).toBe(true)
    expect(accept({ kind: 'ready', attemptId: 2, target })).toBe(true)
    expect(workspaceRemoteAdmission(useWorkspacesStore.getState().workspaces[repoRoot])).toEqual({
      kind: 'remote',
      lifecycleAttemptId: 2,
      lifecycle: { kind: 'ready', target },
    })
  })

  test('rejects an older command response and same-attempt phase regression', () => {
    expect(accept({ kind: 'connecting', attemptId: 3 })).toBe(true)
    expect(accept({ kind: 'failed', attemptId: 3, reason: 'timeout' })).toBe(true)
    expect(accept({ kind: 'ready', attemptId: 2, target })).toBe(false)
    expect(accept({ kind: 'connecting', attemptId: 3 })).toBe(false)
    expect(workspaceRemoteAdmission(useWorkspacesStore.getState().workspaces[repoRoot])).toMatchObject({
      lifecycle: { kind: 'failed', reason: 'timeout' },
    })
  })

  test('rejects a projection for a replaced runtime generation', () => {
    useWorkspacesStore.setState((state) => ({
      workspaces: {
        ...state.workspaces,
        [repoRoot]: { ...state.workspaces[repoRoot]!, workspaceRuntimeId: 'repo-runtime-test-2' },
      },
    }))
    expect(accept({ kind: 'ready', attemptId: 1, target })).toBe(false)
  })

  test('applies only runtime entries represented by this window', () => {
    acceptRemoteWorkspaceLifecycleSnapshot(useWorkspacesStore.setState, useWorkspacesStore.getState, {
      runtimes: [
        {
          workspaceId: repoRoot,
          workspaceRuntimeId,
          workspaceProbe: { status: 'probing' },
          remoteLifecycle: { kind: 'ready', attemptId: 1, target },
        },
        {
          workspaceId: workspaceIdForTest('goblin+ssh://other/repo'),
          workspaceRuntimeId: 'repo-runtime-other',
          workspaceProbe: { status: 'probing' },
          remoteLifecycle: { kind: 'failed', attemptId: 4, reason: 'timeout' },
        },
      ],
    })
    expect(workspaceRemoteAdmission(useWorkspacesStore.getState().workspaces[repoRoot])).toMatchObject({
      lifecycle: { kind: 'ready', target },
    })
    expect(useWorkspacesStore.getState().workspaces['goblin+ssh://other/repo']).toBeUndefined()
  })
})

function accept(
  remoteLifecycle: NonNullable<Parameters<typeof acceptRemoteWorkspaceLifecycleProjection>[2]['remoteLifecycle']>,
) {
  return acceptRemoteWorkspaceLifecycleProjection(useWorkspacesStore.setState, useWorkspacesStore.getState, {
    workspaceId: repoRoot,
    workspaceRuntimeId,
    remoteLifecycle,
  })
}
