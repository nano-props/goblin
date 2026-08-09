import { afterEach, describe, expect, test } from 'vitest'
import { emptyWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { acceptWorkspaceProbeState } from '#/web/stores/workspaces/workspace-guards.ts'
import {
  disposeRepoOperationScheduler,
  markRepoOperationTargets,
  nextRepoOperationId,
} from '#/web/stores/workspaces/repo-operation-scheduler.ts'
import { canStartRemoteFetch } from '#/web/stores/workspaces/sync-state.ts'
import type { RepoOperationTarget } from '#/web/stores/workspaces/operations.ts'
import type { WorkspaceState } from '#/web/stores/workspaces/types.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
type RemoteFetchBlockerKey = 'fetch' | 'branchAction'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///tmp/goblin-sync-state-test')

interface RepoOverrides {
  fetchBusy?: boolean
  branchActionBusy?: boolean
}

function repo(overrides: RepoOverrides = {}): WorkspaceState {
  const base = emptyWorkspace(WORKSPACE_ID, 'repo-runtime-test')
  acceptWorkspaceProbeState(base, {
    status: 'ready',
    capabilities: {
      files: { read: true, write: true },
      terminal: { available: true },
      git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
    },
    diagnostics: [],
  })
  if (overrides.fetchBusy) {
    markRepoOperationTargets(base.id, nextRepoOperationId(base.id), [{ key: 'fetch', reason: 'fetch' }], 'running')
  }
  if (overrides.branchActionBusy) {
    markRepoOperationTargets(
      base.id,
      nextRepoOperationId(base.id),
      [{ key: 'branchAction', reason: 'branch:pull', target: 'feature/a' }],
      'running',
    )
  }
  return base
}

afterEach(() => {
  disposeRepoOperationScheduler(WORKSPACE_ID)
})

describe('canStartRemoteFetch', () => {
  test('requires a repo that is not already busy with network or branch action work', () => {
    expect(canStartRemoteFetch(undefined)).toBe(false)
    expect(canStartRemoteFetch(repo())).toBe(true)
    expect(canStartRemoteFetch(repo({ fetchBusy: true }))).toBe(false)
    expect(canStartRemoteFetch(repo({ branchActionBusy: true }))).toBe(false)
  })

  test.each<RemoteFetchBlockerKey>(['fetch', 'branchAction'])('is blocked while runtime %s work is active', (key) => {
    const r = repo()
    const operationId = nextRepoOperationId(r.id)
    const target: RepoOperationTarget = key === 'branchAction' ? { key, reason: 'branch:pull' } : { key, reason: key }

    markRepoOperationTargets(r.id, operationId, [target], 'running')

    expect(canStartRemoteFetch(r)).toBe(false)
  })
})
