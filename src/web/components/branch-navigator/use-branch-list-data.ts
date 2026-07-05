// Shared branch-list data layer for BranchNavigator. The persistent
// sidebar and zen-mode reveal drawer both render that same pane, so
// branches, route-current branch, view-mode, branch action state,
// and remote metadata stay on one selector.

import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { BranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import type { RepoState, RepoUiState } from '#/web/stores/repos/types.ts'
import { useRepoBranchReadModel, type RepoBranchReadModelData } from '#/web/repo-branch-read-model.ts'

// Composed projection: branch/status/worktree data comes from the repo
// data query; the store contributes only identity, UI, operation, and
// remote shell fields for the list.
export type BranchListRepo = BranchActionRepo & {
  branchModel: Pick<RepoBranchReadModelData, 'branches' | 'currentBranch' | 'status' | 'worktreesByPath'>
  ui: Pick<RepoUiState, 'branchViewMode'>
}

type BranchListRepoShell = Omit<BranchListRepo, 'branchModel'>

const branchListRepoShellEqualFields: Array<keyof BranchListRepoShell> = [
  'id',
  'instanceId',
  'ui',
  'operations',
  'remote',
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
      if (ra.lifecycle !== rb.lifecycle) return false
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
    useReposStore,
    (s) => {
      const repo: RepoState | undefined = s.repos[repoId]
      return repo
        ? {
            id: repo.id,
            instanceId: repo.instanceId,
            ui: {
              branchViewMode: repo.ui.branchViewMode,
            },
            operations: {
              branchAction: repo.operations.branchAction,
            },
            remote: {
              lifecycle: repo.remote.lifecycle,
              hasRemotes: repo.remote.hasRemotes,
              hasBrowserRemote: repo.remote.hasBrowserRemote,
              hasGitHubRemote: repo.remote.hasGitHubRemote,
              browserRemoteProvider: repo.remote.browserRemoteProvider,
              remoteProviders: repo.remote.remoteProviders,
            },
          }
        : undefined
    },
    branchListRepoShellEqual,
  )
  const branchReadModel = useRepoBranchReadModel(repoShell?.id ?? '', repoShell?.instanceId ?? '', !!repoShell)
  if (!repoShell || !branchReadModel) return undefined
  return {
    ...repoShell,
    branchModel: branchReadModel,
  }
}
