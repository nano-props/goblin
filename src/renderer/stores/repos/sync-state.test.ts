import { describe, expect, test } from 'bun:test'
import { emptyRepo } from '#/renderer/stores/repos/helpers.ts'
import { canStartRemoteFetch, isRemoteFetchDue } from '#/renderer/stores/repos/sync-state.ts'
import type { RepoState } from '#/renderer/stores/repos/types.ts'

function repo(overrides: Partial<RepoState> = {}): RepoState {
  return {
    ...emptyRepo('/tmp/goblin-sync-state-test', 'repo'),
    loading: false,
    statusLoading: false,
    ...overrides,
  }
}

describe('canStartRemoteFetch', () => {
  test('requires a repo that is not already busy with core refresh work', () => {
    expect(canStartRemoteFetch(undefined)).toBe(false)
    expect(canStartRemoteFetch(repo())).toBe(true)
    expect(canStartRemoteFetch(repo({ syncing: true }))).toBe(false)
    expect(canStartRemoteFetch(repo({ fetching: true }))).toBe(false)
    expect(canStartRemoteFetch(repo({ loading: true }))).toBe(false)
    expect(canStartRemoteFetch(repo({ statusLoading: true }))).toBe(false)
  })
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
    expect(isRemoteFetchDue(repo({ fetching: true, lastFetchSettledAt: null }), 60_000, 100_000)).toBe(false)
  })
})
