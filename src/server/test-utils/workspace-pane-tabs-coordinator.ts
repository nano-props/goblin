import {
  createWorkspacePaneTabsCoordinator as createProductionWorkspacePaneTabsCoordinator,
  type WorkspacePaneRuntimeTabsLiveSession,
} from '#/server/workspace-pane/workspace-pane-tabs-coordinator.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'

export const TEST_WORKSPACE_PANE_USER_ID = 'user-workspace-pane-tabs'
export const TEST_WORKSPACE_PANE_REPO_ROOT = '/repo'
export const TEST_WORKSPACE_PANE_SCOPE = 'repo-runtime-scope'
export const TEST_WORKSPACE_PANE_BRANCH_NAME = 'feature/worktree'
export const TEST_WORKSPACE_PANE_WORKTREE_PATH = '/repo/worktree'

type ProductionCoordinatorOptions = Parameters<typeof createProductionWorkspacePaneTabsCoordinator>[0]
type TestRuntimeProvider =
  | ProductionCoordinatorOptions['runtimeProviders'][number]
  | {
      type: 'terminal'
      listSessionsForUser(userId: string, scope: string): Promise<WorkspacePaneRuntimeTabsLiveSession[]>
    }

// Production providers expose snapshots; tests need a compact live-session fixture adapter.
export function createTestWorkspacePaneTabsCoordinator(
  options: Omit<ProductionCoordinatorOptions, 'runtimeProviders' | 'persistLayout'> & {
    runtimeProviders: readonly TestRuntimeProvider[]
    persistLayout?: ProductionCoordinatorOptions['persistLayout']
  },
) {
  return createProductionWorkspacePaneTabsCoordinator({
    ...options,
    persistLayout: options.persistLayout ?? (async () => {}),
    runtimeProviders: options.runtimeProviders.map((provider) => {
      if ('captureSnapshotForUser' in provider) return provider
      return {
        type: provider.type,
        async captureSnapshotForUser(userId: string, scope: string) {
          return { revision: 0, liveSessions: await provider.listSessionsForUser(userId, scope) }
        },
      }
    }),
  })
}

export function testWorkspacePaneTarget() {
  return {
    userId: TEST_WORKSPACE_PANE_USER_ID,
    scope: TEST_WORKSPACE_PANE_SCOPE,
    branchName: TEST_WORKSPACE_PANE_BRANCH_NAME,
    worktreePath: TEST_WORKSPACE_PANE_WORKTREE_PATH,
  }
}

export function testWorkspacePaneSnapshot(revision: number, tabs: WorkspacePaneTabEntry[]) {
  return {
    revision,
    entries: [
      {
        repoRoot: TEST_WORKSPACE_PANE_REPO_ROOT,
        branchName: TEST_WORKSPACE_PANE_BRANCH_NAME,
        worktreePath: TEST_WORKSPACE_PANE_WORKTREE_PATH,
        tabs,
      },
    ],
  }
}

export function deferredTestValue<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}
