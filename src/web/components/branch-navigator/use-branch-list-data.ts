// Shared branch-list data layer for BranchNavigator. The persistent
// sidebar and zen-mode reveal drawer both render that same pane, so
// branches, route-current branch, view-mode, branch action state,
// and remote metadata stay on one selector.

import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { projectBranchActionRepo, type BranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import type { GitWorkspaceClientState, WorkspaceState } from '#/web/stores/workspaces/types.ts'
import {
  useRepoOperationsReadModel,
  useRepoSnapshotReadModel,
  useRepoWorktreeStatusReadModel,
} from '#/web/repo-queries.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

// Composed projection: branch/status/worktree data comes from the repo
// data queries; the store contributes only identity, UI, and operation
// shell fields for the list.
export type BranchListRepo = BranchActionRepo & {
  ui: GitWorkspaceClientState['ui']
}

type BranchListRepoShell = Omit<BranchListRepo, 'snapshot' | 'status' | 'branchAction'> & {
  operations: Pick<GitWorkspaceClientState['operations'], 'branchAction'>
}

const branchListRepoShellEqualFields: Array<keyof BranchListRepoShell> = [
  'id',
  'workspaceRuntimeId',
  'ui',
  'operations',
  'remoteLifecycle',
]

function branchListRepoShellEqual(a: BranchListRepoShell | undefined, b: BranchListRepoShell | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  for (const field of branchListRepoShellEqualFields) {
    if (field === 'ui') {
      if (a.ui.branchViewMode !== b.ui.branchViewMode) return false
    } else if (field === 'operations') {
      // The selector rebuilds `{ branchAction }` on every call, so the
      // wrapper reference always changes; compare the inner field
      // directly so unrelated store updates can short-circuit.
      if (a.operations.branchAction !== b.operations.branchAction) return false
    } else {
      if (a[field] !== b[field]) return false
    }
  }
  return true
}

export function useBranchListRepo(repoId: WorkspaceId): BranchListRepo | undefined {
  const repoShell = useStoreWithEqualityFn(
    useWorkspacesStore,
    (s) => {
      const repo: WorkspaceState | undefined = s.workspaces[repoId]
      return repo?.capability.kind === 'git'
        ? {
            id: repo.id,
            workspaceRuntimeId: repo.workspaceRuntimeId,
            ui: {
              branchViewMode: repo.capability.git.ui.branchViewMode,
            },
            operations: {
              branchAction: repo.capability.git.operations.branchAction,
            },
            remoteLifecycle: repo.admission.kind === 'remote' ? repo.admission.lifecycle : null,
          }
        : undefined
    },
    branchListRepoShellEqual,
  )
  const operationsReadModel = useRepoOperationsReadModel(repoShell?.id ?? null, repoShell?.workspaceRuntimeId ?? '', {
    enabled: !!repoShell,
  })
  const snapshotReadModel = useRepoSnapshotReadModel(
    repoShell?.id ?? null,
    repoShell?.workspaceRuntimeId ?? '',
    !!repoShell,
  )
  const statusReadModel = useRepoWorktreeStatusReadModel(
    repoShell?.id ?? null,
    repoShell?.workspaceRuntimeId ?? '',
    !!repoShell,
  )
  const snapshot = snapshotReadModel.data?.snapshot
  if (!repoShell || !snapshot) return undefined
  return {
    ...projectBranchActionRepo(
      { ...repoShell, snapshot, status: statusReadModel.data?.status },
      operationsReadModel.data?.operations,
    ),
  }
}
