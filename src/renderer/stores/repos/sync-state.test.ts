import { afterEach, describe, expect, test } from 'vitest'
import { emptyRepo } from '#/renderer/stores/repos/helpers.ts'
import { markRepoOperationViews } from '#/renderer/stores/repos/operations.ts'
import { finishResourceSuccess, startResource } from '#/renderer/stores/repos/resources.ts'
import { disposeRepoRuntime, markRepoOperationTargets, nextRepoOperationId } from '#/renderer/stores/repos/runtime.ts'
import { canStartRemoteFetch, isRemoteFetchDue } from '#/renderer/stores/repos/sync-state.ts'
import type { RepoRuntimeOperationTarget } from '#/renderer/stores/repos/runtime.ts'
import type { RepoState } from '#/renderer/stores/repos/types.ts'

type CoreRemoteFetchBlockerKey = 'fetch' | 'branchAction' | 'snapshot' | 'status'

interface RepoOverrides {
  fetchBusy?: boolean
  branchActionBusy?: boolean
  snapshotBusy?: boolean
  statusBusy?: boolean
  lastFetchSettledAt?: number | null
}

function repo(overrides: RepoOverrides = {}): RepoState {
  const base = emptyRepo('/tmp/goblin-sync-state-test', 'repo')
  if (overrides.fetchBusy) startResource(base.resources.fetch)
  if (overrides.branchActionBusy) {
    markRepoOperationViews(
      base.operations,
      1,
      [{ key: 'branchAction', reason: 'branch:checkout', target: 'feature/a' }],
      'running',
    )
  }
  if (overrides.snapshotBusy) startResource(base.resources.snapshot)
  if (overrides.statusBusy) startResource(base.resources.status)
  if (overrides.lastFetchSettledAt !== undefined && overrides.lastFetchSettledAt !== null) {
    finishResourceSuccess(base.resources.fetch, overrides.lastFetchSettledAt)
  }
  return base
}

afterEach(() => {
  disposeRepoRuntime('/tmp/goblin-sync-state-test')
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
      const target: RepoRuntimeOperationTarget = { key, reason: key === 'branchAction' ? 'branch:checkout' : key }

      markRepoOperationTargets(r.id, operationId, [target], 'running')

      expect(canStartRemoteFetch(r)).toBe(false)
    },
  )
})

describe('isRemoteFetchDue', () => {
  test('is due when no remote fetch has settled yet', () => {
    expect(isRemoteFetchDue(repo(), 60_000, 100_000)).toBe(true)
  })

  test('is due only after the interval since the last settled fetch', () => {
    expect(isRemoteFetchDue(repo({ lastFetchSettledAt: 50_000 }), 60_000, 100_000)).toBe(false)
    expect(isRemoteFetchDue(repo({ lastFetchSettledAt: 40_000 }), 60_000, 100_000)).toBe(true)
  })

  test('is not due when disabled or core fetch state is busy', () => {
    expect(isRemoteFetchDue(repo(), 0, 100_000)).toBe(false)
    expect(isRemoteFetchDue(repo({ fetchBusy: true, lastFetchSettledAt: null }), 60_000, 100_000)).toBe(false)
    expect(isRemoteFetchDue(repo({ branchActionBusy: true, lastFetchSettledAt: null }), 60_000, 100_000)).toBe(false)
    expect(isRemoteFetchDue(repo({ snapshotBusy: true, lastFetchSettledAt: null }), 60_000, 100_000)).toBe(false)
  })
})
