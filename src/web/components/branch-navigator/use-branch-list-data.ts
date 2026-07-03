// Shared branch-list data layer for BranchNavigator. The persistent
// sidebar and zen-mode reveal drawer both render that same pane, so
// branches, current/selected branch, view-mode, branch action state,
// and remote metadata stay on one selector.

import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { BranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import type { RepoDataState, RepoState, RepoUiState } from '#/web/stores/repos/types.ts'
import { useRepoStatusReadModel } from '#/web/repo-data-query.ts'
import { useRepoBranchReadModel } from '#/web/repo-branch-read-model.ts'

// Composed projection: BranchActionRepo (status, worktrees, currentBranch,
// branch action, remote) + branches + the j/k selection + the worktree
// filter mode. Uses Pick<...> from the store state types so adding a new
// field that's relevant to the list (e.g. ui.someNewFilter) only needs
// the corresponding Pick extended in one place.
export type BranchListRepo = BranchActionRepo & {
  data: BranchActionRepo['data'] & Pick<RepoDataState, 'branches'>
  ui: Pick<RepoUiState, 'selectedBranch' | 'branchViewMode'>
}

const branchListRepoEqualFields: Array<keyof BranchListRepo> = [
  'id',
  'instanceId',
  'data',
  'ui',
  'operations',
  'remote',
]

function branchListRepoEqual(a: BranchListRepo | undefined, b: BranchListRepo | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  for (const field of branchListRepoEqualFields) {
    if (field === 'data') {
      if (a.data.branches !== b.data.branches) return false
      if (a.data.currentBranch !== b.data.currentBranch) return false
      if (a.data.status !== b.data.status) return false
      if (a.data.worktreesByPath !== b.data.worktreesByPath) return false
    } else if (field === 'ui') {
      if (a.ui.selectedBranch !== b.ui.selectedBranch) return false
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
  const repo = useStoreWithEqualityFn(
    useReposStore,
    (s) => {
      const repo: RepoState | undefined = s.repos[repoId]
      return repo
        ? {
            id: repo.id,
            instanceId: repo.instanceId,
            data: {
              branches: repo.data.branches,
              currentBranch: repo.data.currentBranch,
              status: repo.data.status,
              worktreesByPath: repo.data.worktreesByPath,
            },
            ui: {
              selectedBranch: repo.ui.selectedBranch,
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
    branchListRepoEqual,
  )
  const branchReadModel = useRepoBranchReadModel(
    repo?.id ?? '',
    repo?.instanceId ?? '',
    {
      status: repo?.data.status ?? [],
      worktreesByPath: repo?.data.worktreesByPath ?? {},
    },
    !!repo,
  )
  const statusReadModel = useRepoStatusReadModel(repo?.id ?? '', repo?.instanceId ?? '', !!repo)
  if (!repo || (!branchReadModel && !statusReadModel.data)) return repo
  return {
    ...repo,
    data: {
      ...repo.data,
      ...(branchReadModel ?? {}),
      ...(statusReadModel.data ? { status: statusReadModel.data } : {}),
    },
  }
}
