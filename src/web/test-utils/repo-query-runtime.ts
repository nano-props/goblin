import type { GitWorkspaceRuntimeProjection, RepoOperationsSnapshot } from '#/shared/api-types.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

export const WORKSPACE_ID = workspaceIdForTest('goblin+file:///workspace')

export function repoProjectionForTest(
  loadedAt: number,
  branch: string | null = 'feature/a',
  mode: 'summary' | 'full' = 'full',
): GitWorkspaceRuntimeProjection {
  return {
    snapshot: { branches: [], current: 'main' },
    pullRequests: null,
    requested: { branch, pullRequestMode: mode },
    loadedAt,
  }
}

export function repoOperationsForTest(loadedAt: number): RepoOperationsSnapshot {
  return { operations: [], lastFetchAt: null, loadedAt }
}
