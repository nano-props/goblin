import { beforeEach, describe, expect, test } from 'vitest'
import { backgroundSyncTargetsFromStore } from '#/web/hooks/useBackgroundFetch.ts'
import type { WorkspaceState } from '#/web/stores/workspaces/types.ts'
import { emptyWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { acceptWorkspaceProbeState } from '#/web/stores/workspaces/workspace-guards.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { appQueryClient } from '#/web/app-query-client.ts'
import { setRepoSnapshotQueryData } from '#/web/repo-query-cache.ts'

const REMOTE_WORKSPACE_ID = workspaceIdForTest('goblin+file:///remote-workspace')
const LOCAL_WORKSPACE_ID = workspaceIdForTest('goblin+file:///local-workspace')
const UNAVAILABLE_WORKSPACE_ID = workspaceIdForTest('goblin+file:///unavailable-workspace')

beforeEach(() => appQueryClient.clear())

describe('backgroundSyncTargetsFromStore', () => {
  test('keeps the visible remotely backed repo registered from accepted snapshot metadata', () => {
    const repo = createRepo({
      id: REMOTE_WORKSPACE_ID,
      remote: { hasRemotes: true, hasGitHubRemote: true },
    })

    expect(
      backgroundSyncTargetsFromStore({ workspaces: { [REMOTE_WORKSPACE_ID]: repo } }, REMOTE_WORKSPACE_ID),
    ).toEqual([{ workspaceId: REMOTE_WORKSPACE_ID, workspaceRuntimeId: 'workspace-runtime-test' }])
  })

  test('only registers the current repo and excludes local-only and unavailable repos', () => {
    const localOnly = createRepo({
      id: LOCAL_WORKSPACE_ID,
      remote: { hasRemotes: false, hasGitHubRemote: false },
    })
    const unavailable = createRepo({
      id: UNAVAILABLE_WORKSPACE_ID,
      remote: { hasRemotes: true, hasGitHubRemote: true },
      unavailableReason: 'error.workspace-path-not-found',
    })

    expect(
      backgroundSyncTargetsFromStore(
        {
          workspaces: { [LOCAL_WORKSPACE_ID]: localOnly, [UNAVAILABLE_WORKSPACE_ID]: unavailable },
        },
        LOCAL_WORKSPACE_ID,
      ),
    ).toEqual([])
    expect(
      backgroundSyncTargetsFromStore(
        {
          workspaces: { [LOCAL_WORKSPACE_ID]: localOnly, [UNAVAILABLE_WORKSPACE_ID]: unavailable },
        },
        UNAVAILABLE_WORKSPACE_ID,
      ),
    ).toEqual([])
  })

  test('does not register a plain Workspace', () => {
    const workspace = emptyWorkspace(LOCAL_WORKSPACE_ID, 'workspace-runtime-test')
    acceptWorkspaceProbeState(workspace, {
      status: 'ready',
      capabilities: {
        files: { read: true, write: true },
        terminal: { available: true },
        git: { status: 'unavailable' },
      },
      diagnostics: [],
    })

    expect(
      backgroundSyncTargetsFromStore({ workspaces: { [LOCAL_WORKSPACE_ID]: workspace } }, LOCAL_WORKSPACE_ID),
    ).toEqual([])
  })
})

function createRepo(input: {
  id: WorkspaceId
  remote: { hasRemotes: boolean; hasGitHubRemote: boolean }
  unavailableReason?: 'error.workspace-path-not-found'
}): WorkspaceState {
  const readyRepo = emptyWorkspace(input.id, 'workspace-runtime-test')
  if (input.unavailableReason) {
    acceptWorkspaceProbeState(readyRepo, { status: 'unavailable', reason: input.unavailableReason })
    return readyRepo
  }
  acceptWorkspaceProbeState(readyRepo, {
    status: 'ready',
    capabilities: {
      files: { read: true, write: true },
      terminal: { available: true },
      git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
    },
    diagnostics: [],
  })
  setRepoSnapshotQueryData(readyRepo.id, readyRepo.workspaceRuntimeId, {
    branches: [],
    current: '',
    remote: {
      remotes: [],
      hasRemotes: input.remote.hasRemotes,
      hasBrowserRemote: input.remote.hasGitHubRemote,
      browserRemoteProvider: input.remote.hasGitHubRemote ? 'github' : undefined,
      remoteProviders: {},
      hasGitHubRemote: input.remote.hasGitHubRemote,
    },
  })
  return readyRepo
}
