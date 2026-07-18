import { afterEach, describe, expect, test } from 'vitest'
import { emptyWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import {
  disposeRepoOperationScheduler,
  markRepoOperationTargets,
  nextRepoOperationId,
} from '#/web/stores/workspaces/repo-operation-scheduler.ts'
import { canStartRemoteFetch } from '#/web/stores/workspaces/sync-state.ts'
import type { RepoOperationTarget } from '#/web/stores/workspaces/repo-operation-scheduler.ts'
import type { WorkspaceState } from '#/web/stores/workspaces/types.ts'
type RemoteFetchBlockerKey = 'fetch' | 'branchAction' | 'repoReadModel'

interface RepoOverrides {
  fetchBusy?: boolean
  branchActionBusy?: boolean
  repoReadModelBusy?: boolean
}

function repo(overrides: RepoOverrides = {}): WorkspaceState {
  const base = emptyWorkspace('/tmp/goblin-sync-state-test', 'repo', 'repo-runtime-test')
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
  if (overrides.repoReadModelBusy) {
    markRepoOperationTargets(
      base.id,
      nextRepoOperationId(base.id),
      [{ key: 'repoReadModel', reason: 'repo-read-model' }],
      'running',
    )
  }
  return base
}

afterEach(() => {
  disposeRepoOperationScheduler('/tmp/goblin-sync-state-test')
})

describe('canStartRemoteFetch', () => {
  test('requires a repo that is not already busy with projection read work', () => {
    expect(canStartRemoteFetch(undefined)).toBe(false)
    expect(canStartRemoteFetch(repo())).toBe(true)
    expect(canStartRemoteFetch(repo({ fetchBusy: true }))).toBe(false)
    expect(canStartRemoteFetch(repo({ branchActionBusy: true }))).toBe(false)
    expect(canStartRemoteFetch(repo({ repoReadModelBusy: true }))).toBe(false)
  })

  test.each<RemoteFetchBlockerKey>(['fetch', 'branchAction', 'repoReadModel'])(
    'is blocked while runtime %s work is active',
    (key) => {
      const r = repo()
      const operationId = nextRepoOperationId(r.id)
      const target: RepoOperationTarget =
        key === 'branchAction'
          ? { key, reason: 'branch:pull' }
          : key === 'repoReadModel'
            ? { key, reason: 'repo-read-model' }
            : { key, reason: key }

      markRepoOperationTargets(r.id, operationId, [target], 'running')

      expect(canStartRemoteFetch(r)).toBe(false)
    },
  )
})
