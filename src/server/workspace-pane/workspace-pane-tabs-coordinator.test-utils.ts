import {
  WorkspacePaneLayoutAggregate,
  type WorkspacePaneTargetProjection,
} from '#/server/workspace-pane/workspace-pane-layout-aggregate.ts'
import type { WorkspacePaneLayoutRepository } from '#/server/workspace-pane/workspace-pane-layout-repository.ts'
import type { WorkspacePaneLayoutRestoreTransaction } from '#/server/workspace-pane/workspace-pane-layout-restore-transaction.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { localWorkspaceSessionEntry } from '#/shared/remote-workspace.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import {
  workspacePaneTabsBranchIdentity,
  workspacePaneTabsTargetWorktreePath,
  type WorkspacePaneTabsTarget,
} from '#/shared/workspace-pane-tabs-target.ts'

// Vitest has no reusable fixture for coordinator repositories and runtime target projections.
export const WORKSPACE_ID = workspaceIdForTest('goblin+file:///repo')
export const LOCAL_WORKSPACE_ENTRY = localWorkspaceSessionEntry(WORKSPACE_ID)

export function aggregateFor(
  repository: WorkspacePaneLayoutRepository,
  restoreTransaction: WorkspacePaneLayoutRestoreTransaction = {
    async validateMembershipAndLoad(input) {
      const current = await repository.load(input.workspaceId)
      return { kind: 'accepted' as const, snapshot: current }
    },
  },
): WorkspacePaneLayoutAggregate {
  return new WorkspacePaneLayoutAggregate({ repository, restoreTransaction })
}

export type TestWorkspacePaneTarget =
  WorkspacePaneTabsTarget | { workspaceId: string; branchName: string; worktreePath: string | null }

export function testTargetProjection(targets: readonly TestWorkspacePaneTarget[]) {
  return {
    captureTargets: async () => targets.map(testRuntimeTargetProjection),
  }
}

export function testRuntimeTargetProjection(target: TestWorkspacePaneTarget): WorkspacePaneTargetProjection {
  const workspaceId = canonicalWorkspaceLocator(target.workspaceId)
  if (!workspaceId) throw new Error('invalid workspace locator fixture')
  const branchName = 'kind' in target ? workspacePaneTabsBranchIdentity(target) : target.branchName
  const worktreePath = 'kind' in target ? workspacePaneTabsTargetWorktreePath(target) : target.worktreePath
  if (worktreePath === null) {
    if (!branchName) throw new Error('branch fixture required')
    return {
      target: { kind: 'git-branch', workspaceId, workspaceRuntimeId: 'runtime-a', branch: branchName },
      nativeWorktreePath: null,
      canonicalBranch: branchName,
    }
  }
  if (!worktreePath) throw new Error('worktree fixture required')
  const root = canonicalWorkspaceLocator(`goblin+file://${worktreePath}`)
  if (!root) throw new Error('invalid worktree locator fixture')
  return {
    target: { kind: 'git-worktree', workspaceId, workspaceRuntimeId: 'runtime-a', root },
    nativeWorktreePath: worktreePath,
    canonicalBranch: branchName,
  }
}
