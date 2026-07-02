import { afterEach, describe, expect, test } from 'vitest'
import { emptyRepo } from '#/web/stores/repos/repo-state-factory.ts'
import {
  disposeRepoOperationScheduler,
  markRepoOperationTargets,
  nextRepoOperationId,
} from '#/web/stores/repos/repo-operation-scheduler.ts'
import { canStartRemoteFetch } from '#/web/stores/repos/sync-state.ts'
import type { RepoOperationTarget } from '#/web/stores/repos/repo-operation-scheduler.ts'
import type { RepoState } from '#/web/stores/repos/types.ts'
type CoreRemoteFetchBlockerKey = 'fetch' | 'branchAction' | 'snapshot' | 'status'

interface RepoOverrides {
  fetchBusy?: boolean
  branchActionBusy?: boolean
  snapshotBusy?: boolean
  statusBusy?: boolean
}

function repo(overrides: RepoOverrides = {}): RepoState {
  const base = emptyRepo('/tmp/goblin-sync-state-test', 'repo', 'repo-instance-test')
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
  if (overrides.snapshotBusy) {
    markRepoOperationTargets(
      base.id,
      nextRepoOperationId(base.id),
      [{ key: 'snapshot', reason: 'snapshot' }],
      'running',
    )
  }
  if (overrides.statusBusy) {
    markRepoOperationTargets(base.id, nextRepoOperationId(base.id), [{ key: 'status', reason: 'status' }], 'running')
  }
  return base
}

afterEach(() => {
  disposeRepoOperationScheduler('/tmp/goblin-sync-state-test')
})

describe('canStartRemoteFetch', () => {
  test('requires a repo that is not already busy with core refresh work', () => {
    expect(canStartRemoteFetch(undefined)).toBe(false)
    expect(canStartRemoteFetch(repo())).toBe(true)
    expect(canStartRemoteFetch(repo({ fetchBusy: true }))).toBe(false)
    expect(canStartRemoteFetch(repo({ branchActionBusy: true }))).toBe(false)
    expect(canStartRemoteFetch(repo({ snapshotBusy: true }))).toBe(false)
    expect(canStartRemoteFetch(repo({ statusBusy: true }))).toBe(false)
  })

  test.each<CoreRemoteFetchBlockerKey>(['fetch', 'branchAction', 'snapshot', 'status'])(
    'is blocked while runtime %s work is active',
    (key) => {
      const r = repo()
      const operationId = nextRepoOperationId(r.id)
      const target: RepoOperationTarget = { key, reason: key === 'branchAction' ? 'branch:pull' : key }

      markRepoOperationTargets(r.id, operationId, [target], 'running')

      expect(canStartRemoteFetch(r)).toBe(false)
    },
  )
})
