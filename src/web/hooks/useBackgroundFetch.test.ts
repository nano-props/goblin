import { describe, expect, test } from 'vitest'
import { backgroundSyncRepoIdsFromStore } from '#/web/hooks/useBackgroundFetch.ts'
import type { RepoState, ReposStore } from '#/web/stores/repos/types.ts'

describe('backgroundSyncRepoIdsFromStore', () => {
  test('keeps the active remotely backed repo registered while local refresh resources are busy', () => {
    const repo = createRepo({
      id: '/repo',
      remote: { hasRemotes: true, hasGitHubRemote: true },
      availability: { phase: 'available' },
    })
    repo.resources.snapshot.phase = 'refreshing'
    repo.resources.status.phase = 'refreshing'
    repo.operations.snapshot.phase = 'running'
    repo.operations.status.phase = 'running'

    expect(backgroundSyncRepoIdsFromStore({ activeId: '/repo', repos: { '/repo': repo } })).toEqual(['/repo'])
  })

  test('only registers the active repo and excludes local-only and unavailable repos', () => {
    const localOnly = createRepo({
      id: '/local',
      remote: { hasRemotes: false, hasGitHubRemote: false },
      availability: { phase: 'available' },
    })
    const unavailable = createRepo({
      id: '/down',
      remote: { hasRemotes: true, hasGitHubRemote: true },
      availability: { phase: 'unavailable', reason: 'error.failed-read-repo', checkedAt: Date.now() },
    })

    expect(
      backgroundSyncRepoIdsFromStore({
        activeId: '/local',
        repos: { '/local': localOnly, '/down': unavailable },
      }),
    ).toEqual([])
    expect(
      backgroundSyncRepoIdsFromStore({
        activeId: '/down',
        repos: { '/local': localOnly, '/down': unavailable },
      }),
    ).toEqual([])
  })
})

function createRepo(input: {
  id: string
  remote: { hasRemotes: boolean; hasGitHubRemote: boolean }
  availability: RepoState['availability']
}): RepoState {
  return {
    id: input.id,
    name: 'repo',
    instanceToken: 1,
    data: {
      branches: [],
      currentBranch: '',
      status: [],
      statusLoaded: false,
      worktreesByPath: {},
    },
    resources: {
      fetch: { phase: 'idle', loadedAt: null, stale: false, error: null },
      snapshot: { phase: 'idle', loadedAt: null, stale: false, error: null },
      status: { phase: 'idle', loadedAt: null, stale: false, error: null },
      pullRequests: { phase: 'idle', loadedAt: null, stale: false, error: null, mode: null },
      pullRequestsByBranch: {},
    },
    operations: {
      fetch: {
        operationId: 0,
        phase: 'idle',
        reason: null,
        target: null,
        startedAt: null,
        settledAt: null,
        error: null,
      },
      manualRefresh: {
        operationId: 0,
        phase: 'idle',
        reason: null,
        target: null,
        startedAt: null,
        settledAt: null,
        error: null,
      },
      snapshot: {
        operationId: 0,
        phase: 'idle',
        reason: null,
        target: null,
        startedAt: null,
        settledAt: null,
        error: null,
      },
      status: {
        operationId: 0,
        phase: 'idle',
        reason: null,
        target: null,
        startedAt: null,
        settledAt: null,
        error: null,
      },
      pullRequests: {
        operationId: 0,
        phase: 'idle',
        reason: null,
        target: null,
        startedAt: null,
        settledAt: null,
        error: null,
      },
      branchAction: {
        operationId: 0,
        phase: 'idle',
        reason: null,
        target: null,
        startedAt: null,
        settledAt: null,
        error: null,
      },
      pullRequestsByBranch: {},
    },
    ui: {
      selectedBranch: null,
      branchViewMode: 'all',
      preferredDetailTab: 'status',
    },
    projection: { source: 'fresh', savedAt: null },
    remote: {
      lifecycle: null,
      remotes: [],
      remoteDetails: [],
      hasRemotes: input.remote.hasRemotes,
      hasBrowserRemote: input.remote.hasGitHubRemote,
      browserRemoteProvider: input.remote.hasGitHubRemote ? 'github' : undefined,
      remoteProviders: {},
      hasGitHubRemote: input.remote.hasGitHubRemote,
      fetchFailed: false,
      fetchError: null,
    },
    availability: input.availability,
    events: [],
  } as RepoState
}
