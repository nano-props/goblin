import { beforeEach, describe, expect, test } from 'vitest'
import { normalizeRemoteTarget } from '#/shared/remote-repo.ts'
import { emptyRepo } from '#/web/stores/repos/repo-state-factory.ts'
import {
  acceptRemoteLifecycleProjection,
  acceptRemoteLifecycleSnapshot,
} from '#/web/stores/repos/remote-lifecycle-projection.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'

const repoRoot = 'goblin+ssh://example/repo'
const repoRuntimeId = 'repo-runtime-test-1'
const target = normalizeRemoteTarget({
  alias: 'example',
  host: 'example.test',
  user: 'developer',
  port: 22,
  remotePath: '/repo',
})!

describe('remote lifecycle projection acceptance', () => {
  beforeEach(() => {
    const repo = emptyRepo(repoRoot, 'repo', repoRuntimeId)
    useReposStore.setState({ repos: { [repoRoot]: repo }, order: [repoRoot] })
  })

  test('accepts connecting then terminal within one server attempt', () => {
    expect(accept({ kind: 'connecting', attemptId: 2 })).toBe(true)
    expect(accept({ kind: 'ready', attemptId: 2, target })).toBe(true)
    expect(useReposStore.getState().repos[repoRoot]?.remote).toMatchObject({
      lifecycleAttemptId: 2,
      lifecycle: { kind: 'ready', target },
    })
  })

  test('rejects an older command response and same-attempt phase regression', () => {
    expect(accept({ kind: 'connecting', attemptId: 3 })).toBe(true)
    expect(accept({ kind: 'failed', attemptId: 3, reason: 'timeout' })).toBe(true)
    expect(accept({ kind: 'ready', attemptId: 2, target })).toBe(false)
    expect(accept({ kind: 'connecting', attemptId: 3 })).toBe(false)
    expect(useReposStore.getState().repos[repoRoot]?.remote.lifecycle).toEqual({
      kind: 'failed',
      reason: 'timeout',
    })
  })

  test('rejects a projection for a replaced runtime generation', () => {
    useReposStore.setState((state) => ({
      repos: { ...state.repos, [repoRoot]: { ...state.repos[repoRoot]!, repoRuntimeId: 'repo-runtime-test-2' } },
    }))
    expect(accept({ kind: 'ready', attemptId: 1, target })).toBe(false)
  })

  test('applies only runtime entries represented by this window', () => {
    acceptRemoteLifecycleSnapshot(useReposStore.setState, useReposStore.getState, {
      runtimes: [
        {
          repoRoot,
          repoRuntimeId,
          workspaceProbe: { status: 'probing' },
          remoteLifecycle: { kind: 'ready', attemptId: 1, target },
        },
        {
          repoRoot: 'goblin+ssh://other/repo',
          repoRuntimeId: 'repo-runtime-other',
          workspaceProbe: { status: 'probing' },
          remoteLifecycle: { kind: 'failed', attemptId: 4, reason: 'timeout' },
        },
      ],
    })
    expect(useReposStore.getState().repos[repoRoot]?.remote.lifecycle).toEqual({ kind: 'ready', target })
    expect(useReposStore.getState().repos['goblin+ssh://other/repo']).toBeUndefined()
  })
})

function accept(
  remoteLifecycle: NonNullable<Parameters<typeof acceptRemoteLifecycleProjection>[2]['remoteLifecycle']>,
) {
  return acceptRemoteLifecycleProjection(useReposStore.setState, useReposStore.getState, {
    repoRoot,
    repoRuntimeId,
    remoteLifecycle,
  })
}
