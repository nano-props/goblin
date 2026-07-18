// Shared branch-list data layer for BranchNavigator. The persistent
// sidebar and zen-mode reveal drawer both render that same pane, so
// branches, route-current branch, view-mode, branch action state,
// and remote metadata stay on one selector.

import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { projectBranchActionRepo, type BranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import type { GitWorkspaceProjection, WorkspaceState } from '#/web/stores/workspaces/types.ts'
import { useRepoBranchReadModel, type RepoBranchReadModelData } from '#/web/repo-branch-read-model.ts'
import { useRepoOperationsReadModel } from '#/web/repo-data-query.ts'

// Composed projection: branch/status/worktree data comes from the repo
// data query; the store contributes only identity, UI, operation, and
// remote shell fields for the list.
export type BranchListRepo = BranchActionRepo & {
  branchModel: Pick<RepoBranchReadModelData, 'branches' | 'currentBranch' | 'status' | 'worktreesByPath'>
  ui: GitWorkspaceProjection['ui']
}

type BranchListRepoShell = Omit<BranchListRepo, 'branchModel' | 'branchAction'> & {
  operations: Pick<GitWorkspaceProjection['operations'], 'branchAction'>
}

const branchListRepoShellEqualFields: Array<keyof BranchListRepoShell> = [
  'id',
  'workspaceRuntimeId',
  'ui',
  'operations',
  'remote',
  'remoteLifecycle',
]

function branchListRepoShellEqual(a: BranchListRepoShell | undefined, b: BranchListRepoShell | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  for (const field of branchListRepoShellEqualFields) {
    if (field === 'ui') {
      if (a.ui.branchViewMode !== b.ui.branchViewMode) return false
    } else if (field === 'remote') {
      const ra = a.remote
      const rb = b.remote
      if (ra.hasRemotes !== rb.hasRemotes) return false
      if (ra.hasBrowserRemote !== rb.hasBrowserRemote) return false
      if (ra.hasGitHubRemote !== rb.hasGitHubRemote) return false
      if (ra.browserRemoteProvider !== rb.browserRemoteProvider) return false
      if (ra.remoteProviders !== rb.remoteProviders) return false
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

export function useBranchListRepo(repoId: string): BranchListRepo | undefined {
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
            remote: {
              hasRemotes: repo.capability.git.remote.hasRemotes,
              hasBrowserRemote: repo.capability.git.remote.hasBrowserRemote,
              hasGitHubRemote: repo.capability.git.remote.hasGitHubRemote,
              browserRemoteProvider: repo.capability.git.remote.browserRemoteProvider,
              remoteProviders: repo.capability.git.remote.remoteProviders,
            },
            remoteLifecycle: repo.admission.kind === 'remote' ? repo.admission.lifecycle : null,
          }
        : undefined
    },
    branchListRepoShellEqual,
  )
  const operationsReadModel = useRepoOperationsReadModel(repoShell?.id ?? '', repoShell?.workspaceRuntimeId ?? '', {
    enabled: !!repoShell,
  })
  const branchReadModel = useRepoBranchReadModel(repoShell?.id ?? '', repoShell?.workspaceRuntimeId ?? '', !!repoShell)
  if (!repoShell || !branchReadModel) return undefined
  return {
    ...projectBranchActionRepo(repoShell, operationsReadModel.data?.operations),
    branchModel: branchReadModel,
  }
}
