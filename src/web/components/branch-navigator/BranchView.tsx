// Single source of truth for the left-pane branch list. The persistent
// sidebar and the zen-mode reveal drawer both render BranchNavigator,
// so branch selection, filtering, action menus, and empty state stay
// in one data path.

import { useMemo } from 'react'
import { useT } from '#/web/stores/i18n.ts'
import { visibleBranches } from '#/web/stores/repos/branch-view-mode.ts'
import { BranchList } from '#/web/components/branch-navigator/BranchList.tsx'
import { useBranchListRepo } from '#/web/components/branch-navigator/use-branch-list-data.ts'
import { EmptyState } from '#/web/components/Layout.tsx'
import { usePrimaryWindowNavigation } from '#/web/primary-window-navigation.tsx'
import { dispatchShowWorkspacePaneStaticTabAction } from '#/web/workspace-pane/workspace-pane-tab-open-action.ts'
import { BranchNavigatorSkeleton } from '#/web/components/Skeleton.tsx'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useRepoWorktreeStatusReadModel } from '#/web/repo-data-query.ts'
import { RepoStatusFailureView, RepoStatusStaleNotice } from '#/web/components/RepoStatusFailureView.tsx'
import { refreshRepoWorktreeStatus } from '#/web/stores/repos/worktree-status-refresh.ts'

interface Props {
  repoId: string
  onSelectBranch?: (branch: string) => void
  currentBranchName?: string | null
  /** Run after the user picks a row. Kept optional for embedded
   * surfaces that need to react after selection. */
  onAfterSelect?: (branch: string) => void
  /** Run after the user double-clicks a row to open its status pane. */
  onAfterOpenStatus?: (branch: string) => void
}

export function BranchView({ repoId, onSelectBranch, currentBranchName, onAfterSelect, onAfterOpenStatus }: Props) {
  const t = useT()
  const navigation = usePrimaryWindowNavigation()
  const workspaceRuntimeId = useReposStore((state) => state.repos[repoId]?.workspaceRuntimeId ?? null)
  const statusReadModel = useRepoWorktreeStatusReadModel(repoId, workspaceRuntimeId ?? '', workspaceRuntimeId !== null)
  const repo = useBranchListRepo(repoId)

  const branches = useMemo(
    () =>
      repo
        ? visibleBranches({
            branches: repo.branchModel.branches,
            viewMode: repo.ui.branchViewMode,
          })
        : [],
    [repo],
  )

  const handleSelectBranch = (branch: string) => {
    if (onSelectBranch) onSelectBranch(branch)
    else navigation.selectRepoBranch(repoId, branch)
    onAfterSelect?.(branch)
  }

  const handleOpenBranchStatus = (branchName: string) => {
    void dispatchShowWorkspacePaneStaticTabAction({
      repoId,
      branchName,
      type: 'status',
      workspacePaneRoute: undefined,
      navigation,
    })
    onAfterOpenStatus?.(branchName)
  }

  const emptyLabel = repo
    ? repo.branchModel.branches.length === 0
      ? 'branches.empty'
      : 'branches.filter-empty'
    : 'branches.empty'

  const highlightedBranch = currentBranchName ?? null
  const statusError = statusReadModel.error
  const statusErrorKey = statusError instanceof Error ? statusError.message : statusError ? String(statusError) : null
  const retryStatus = () => {
    if (!workspaceRuntimeId) return
    void refreshRepoWorktreeStatus({ get: useReposStore.getState }, repoId, workspaceRuntimeId)
  }

  if (!repo && !statusReadModel.data && statusReadModel.isError && workspaceRuntimeId) {
    return (
      <RepoStatusFailureView
        messageKey={statusErrorKey ?? 'error.failed-read-repo'}
        retrying={statusReadModel.isFetching}
        onRetry={retryStatus}
      />
    )
  }
  if (!repo) return <BranchNavigatorSkeleton />

  return (
    <>
      {statusReadModel.data && statusReadModel.isError && statusErrorKey && (
        <RepoStatusStaleNotice
          messageKey={statusErrorKey}
          retrying={statusReadModel.isFetching}
          onRetry={retryStatus}
        />
      )}
      <BranchList
        repo={repo}
        branches={branches}
        highlightedBranch={highlightedBranch}
        onSelectBranch={handleSelectBranch}
        onOpenBranchStatus={handleOpenBranchStatus}
        emptyState={<EmptyState title={t(emptyLabel)} />}
      />
    </>
  )
}
