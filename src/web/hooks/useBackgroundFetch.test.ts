import { describe, expect, test } from 'vitest'
import { backgroundSyncRepoIdsFromStore } from '#/web/hooks/useBackgroundFetch.ts'
import type { RepoState } from '#/web/stores/repos/types.ts'
import { emptyRepo } from '#/web/stores/repos/repo-state-factory.ts'

describe('backgroundSyncRepoIdsFromStore', () => {
  test('keeps the visible remotely backed repo registered while local refresh data loads are busy', () => {
    const repo = createRepo({
      id: '/repo',
      remote: { hasRemotes: true, hasGitHubRemote: true },
      availability: { phase: 'available' },
    })
    repo.dataLoads.repoReadModel.phase = 'refreshing'
    repo.operations.repoReadModel.phase = 'running'

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
