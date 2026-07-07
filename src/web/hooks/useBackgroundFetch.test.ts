import { describe, expect, test } from 'vitest'
import { backgroundSyncRepoIdsFromStore } from '#/web/hooks/useBackgroundFetch.ts'
import type { RepoState } from '#/web/stores/repos/types.ts'

describe('backgroundSyncRepoIdsFromStore', () => {
  test('keeps the visible remotely backed repo registered while local refresh data loads are busy', () => {
    const repo = createRepo({
      id: '/repo',
      remote: { hasRemotes: true, hasGitHubRemote: true },
      availability: { phase: 'available' },
    })
    repo.dataLoads.snapshot.phase = 'refreshing'
    repo.dataLoads.status.phase = 'refreshing'
    repo.operations.repoReadModel.phase = 'running'
    repo.operations.visibleStatus.phase = 'running'

    expect(backgroundSyncRepoIdsFromStore({ repos: { '/repo': repo } }, '/repo')).toEqual(['/repo'])
  })

  test('only registers the current repo and excludes local-only and unavailable repos', () => {
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
      backgroundSyncRepoIdsFromStore(
        {
          repos: { '/local': localOnly, '/down': unavailable },
        },
        '/local',
      ),
    ).toEqual([])
    expect(
      backgroundSyncRepoIdsFromStore(
        {
          repos: { '/local': localOnly, '/down': unavailable },
        },
        '/down',
      ),
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
    instanceId: 'repo-instance-test',
    dataLoads: {
      fetch: { phase: 'idle', loadedAt: null, stale: false, error: null },
      snapshot: { phase: 'idle', loadedAt: null, stale: false, error: null },
      status: { phase: 'idle', loadedAt: null, stale: false, error: null },
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
      repoReadModel: {
        operationId: 0,
        phase: 'idle',
        reason: null,
        target: null,
        startedAt: null,
        settledAt: null,
        error: null,
      },
      visibleStatus: {
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
    },
    ui: {
      currentBranchName: null,
      branchViewMode: 'all',
      workspacePaneTabsByBranch: {},
      preferredWorkspacePaneTabByTarget: {},
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
