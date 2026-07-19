import { describe, expect, test } from 'vitest'
import { backgroundSyncRepoIdsFromStore } from '#/web/hooks/useBackgroundFetch.ts'
import type { WorkspaceState } from '#/web/stores/workspaces/types.ts'
import { emptyWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { acceptWorkspaceProbeState } from '#/web/stores/workspaces/workspace-guards.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

const REMOTE_WORKSPACE_ID = workspaceIdForTest('goblin+file:///remote-workspace')
const LOCAL_WORKSPACE_ID = workspaceIdForTest('goblin+file:///local-workspace')
const UNAVAILABLE_WORKSPACE_ID = workspaceIdForTest('goblin+file:///unavailable-workspace')

describe('backgroundSyncRepoIdsFromStore', () => {
  test('keeps the visible remotely backed repo registered while local refresh data loads are busy', () => {
    const repo = createRepo({
      id: REMOTE_WORKSPACE_ID,
      remote: { hasRemotes: true, hasGitHubRemote: true },
      availability: { phase: 'available' },
    })
    if (repo.capability.kind !== 'git') throw new Error('expected Git capability')
    repo.capability.git.dataLoads.repoReadModel.phase = 'refreshing'
    repo.capability.git.operations.repoReadModel.phase = 'running'

    expect(
      backgroundSyncRepoIdsFromStore({ workspaces: { [REMOTE_WORKSPACE_ID]: repo } }, REMOTE_WORKSPACE_ID),
    ).toEqual([REMOTE_WORKSPACE_ID])
  })

  test('only registers the current repo and excludes local-only and unavailable repos', () => {
    const localOnly = createRepo({
      id: LOCAL_WORKSPACE_ID,
      remote: { hasRemotes: false, hasGitHubRemote: false },
      availability: { phase: 'available' },
    })
    const unavailable = createRepo({
      id: UNAVAILABLE_WORKSPACE_ID,
      remote: { hasRemotes: true, hasGitHubRemote: true },
      availability: { phase: 'unavailable', reason: 'error.failed-read-repo', checkedAt: Date.now() },
    })

    expect(
      backgroundSyncRepoIdsFromStore(
        {
          workspaces: { [LOCAL_WORKSPACE_ID]: localOnly, [UNAVAILABLE_WORKSPACE_ID]: unavailable },
        },
        LOCAL_WORKSPACE_ID,
      ),
    ).toEqual([])
    expect(
      backgroundSyncRepoIdsFromStore(
        {
          workspaces: { [LOCAL_WORKSPACE_ID]: localOnly, [UNAVAILABLE_WORKSPACE_ID]: unavailable },
        },
        UNAVAILABLE_WORKSPACE_ID,
      ),
    ).toEqual([])
  })
})

function createRepo(input: {
  id: WorkspaceId
  remote: { hasRemotes: boolean; hasGitHubRemote: boolean }
  availability: WorkspaceState['availability']
}): WorkspaceState {
  const repo = emptyWorkspace(input.id, 'repo', 'repo-runtime-test')
  const readyRepo: WorkspaceState = {
    ...repo,
    availability: input.availability,
  }
  acceptWorkspaceProbeState(readyRepo, {
    status: 'ready',
    name: 'repo',
    capabilities: {
      files: { read: true, write: true },
      terminal: { available: true },
      git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
    },
    diagnostics: [],
  })
  if (readyRepo.capability.kind !== 'git') throw new Error('expected Git capability')
  readyRepo.capability.git.remote.hasRemotes = input.remote.hasRemotes
  readyRepo.capability.git.remote.hasBrowserRemote = input.remote.hasGitHubRemote
  readyRepo.capability.git.remote.browserRemoteProvider = input.remote.hasGitHubRemote ? 'github' : undefined
  readyRepo.capability.git.remote.hasGitHubRemote = input.remote.hasGitHubRemote
  return readyRepo
}
