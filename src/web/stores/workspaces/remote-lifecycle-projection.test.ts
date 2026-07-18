import { beforeEach, describe, expect, test } from 'vitest'
import { normalizeRemoteTarget } from '#/shared/remote-repo.ts'
import { emptyWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import {
  acceptRemoteLifecycleProjection,
  acceptRemoteLifecycleSnapshot,
} from '#/web/stores/workspaces/remote-lifecycle-projection.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'

const repoRoot = 'goblin+ssh://example/repo'
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
    expect(useWorkspacesStore.getState().workspaces[repoRoot]?.remote).toMatchObject({
      lifecycleAttemptId: 2,
      lifecycle: { kind: 'ready', target },
    })
  })

  test('rejects an older command response and same-attempt phase regression', () => {
    expect(accept({ kind: 'connecting', attemptId: 3 })).toBe(true)
    expect(accept({ kind: 'failed', attemptId: 3, reason: 'timeout' })).toBe(true)
    expect(accept({ kind: 'ready', attemptId: 2, target })).toBe(false)
    expect(accept({ kind: 'connecting', attemptId: 3 })).toBe(false)
    expect(useWorkspacesStore.getState().workspaces[repoRoot]?.remote.lifecycle).toEqual({
      kind: 'failed',
      reason: 'timeout',
    })
  })

  test('rejects a projection for a replaced runtime generation', () => {
    useWorkspacesStore.setState((state) => ({
      workspaces: { ...state.workspaces, [repoRoot]: { ...state.workspaces[repoRoot]!, workspaceRuntimeId: 'repo-runtime-test-2' } },
    }))
    expect(accept({ kind: 'ready', attemptId: 1, target })).toBe(false)
  })

  test('applies only runtime entries represented by this window', () => {
    acceptRemoteLifecycleSnapshot(useWorkspacesStore.setState, useWorkspacesStore.getState, {
      runtimes: [
        {
          workspaceId: repoRoot,
          workspaceRuntimeId,
          workspaceProbe: { status: 'probing' },
          remoteLifecycle: { kind: 'ready', attemptId: 1, target },
        },
        {
          workspaceId: 'goblin+ssh://other/repo',
          workspaceRuntimeId: 'repo-runtime-other',
          workspaceProbe: { status: 'probing' },
          remoteLifecycle: { kind: 'failed', attemptId: 4, reason: 'timeout' },
        },
      ],
    })
    expect(useWorkspacesStore.getState().workspaces[repoRoot]?.remote.lifecycle).toEqual({ kind: 'ready', target })
    expect(useWorkspacesStore.getState().workspaces['goblin+ssh://other/repo']).toBeUndefined()
  })
})

function accept(
  remoteLifecycle: NonNullable<Parameters<typeof acceptRemoteLifecycleProjection>[2]['remoteLifecycle']>,
) {
  return acceptRemoteLifecycleProjection(useWorkspacesStore.setState, useWorkspacesStore.getState, {
    workspaceId: repoRoot,
    workspaceRuntimeId,
    remoteLifecycle,
  })
}
