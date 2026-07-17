import { describe, expect, test } from 'vitest'
import { backgroundSyncRepoIdsFromStore } from '#/web/hooks/useBackgroundFetch.ts'
import type { RepoState } from '#/web/stores/repos/types.ts'
import { emptyRepo } from '#/web/stores/repos/repo-state-factory.ts'

describe('backgroundSyncRepoIdsFromStore', () => {
  test('keeps the visible remotely backed repo registered while local refresh data loads are busy', () => {
    const repo = createRepo({
      id: 'goblin+file:///repo',
      remote: { hasRemotes: true, hasGitHubRemote: true },
      availability: { phase: 'available' },
    })
    repo.dataLoads.repoReadModel.phase = 'refreshing'
    repo.operations.repoReadModel.phase = 'running'

    expect(backgroundSyncRepoIdsFromStore({ repos: { 'goblin+file:///repo': repo } }, 'goblin+file:///repo')).toEqual([
      'goblin+file:///repo',
    ])
  })

  test('only registers the current repo and excludes local-only and unavailable repos', () => {
    const localOnly = createRepo({
      id: 'goblin+file:///local',
      remote: { hasRemotes: false, hasGitHubRemote: false },
      availability: { phase: 'available' },
    })
    const unavailable = createRepo({
      id: 'goblin+file:///down',
      remote: { hasRemotes: true, hasGitHubRemote: true },
      availability: { phase: 'unavailable', reason: 'error.failed-read-repo', checkedAt: Date.now() },
    })

    expect(
      backgroundSyncRepoIdsFromStore(
        {
          repos: { 'goblin+file:///local': localOnly, 'goblin+file:///down': unavailable },
        },
        'goblin+file:///local',
      ),
    ).toEqual([])
    expect(
      backgroundSyncRepoIdsFromStore(
        {
          repos: { 'goblin+file:///local': localOnly, 'goblin+file:///down': unavailable },
        },
        'goblin+file:///down',
      ),
    ).toEqual([])
  })
})

function createRepo(input: {
  id: string
  remote: { hasRemotes: boolean; hasGitHubRemote: boolean }
  availability: RepoState['availability']
}): RepoState {
  const repo = emptyRepo(input.id, 'repo', 'repo-runtime-test')
  return {
    ...repo,
    remote: {
      ...repo.remote,
      hasRemotes: input.remote.hasRemotes,
      hasBrowserRemote: input.remote.hasGitHubRemote,
      browserRemoteProvider: input.remote.hasGitHubRemote ? 'github' : undefined,
      hasGitHubRemote: input.remote.hasGitHubRemote,
    },
    availability: input.availability,
  }
}
