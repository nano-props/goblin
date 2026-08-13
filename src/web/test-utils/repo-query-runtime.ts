import type { RepoOperationsSnapshot, RepoSnapshotResponse } from '#/shared/api-types.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

export const WORKSPACE_ID = workspaceIdForTest('goblin+file:///workspace')

export function repoSnapshotResponseForTest(): RepoSnapshotResponse {
  return {
    snapshot: {
      branches: [],
      worktrees: [],
      current: 'main',
      remote: {
        remotes: [],
        hasRemotes: false,
        hasBrowserRemote: false,
        remoteProviders: {},
        hasGitHubRemote: false,
      },
    },
  }
}

export function repoOperationsForTest(loadedAt: number): RepoOperationsSnapshot {
  return { operations: [], lastFetchAt: null, loadedAt }
}
