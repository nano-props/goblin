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
import { openWorkspacePaneTab } from '#/web/components/repo-workspace/open-workspace-pane-tab.ts'
import { BranchNavigatorSkeleton } from '#/web/components/Skeleton.tsx'

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
    const branch = repo?.branchModel.branches.find((candidate) => candidate.name === branchName)
    void openWorkspacePaneTab({
      repoId,
      branchName,
      worktreePath: branch?.worktree?.path ?? null,
      type: 'status',
      insertAfterIdentity: null,
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

  if (!repo) return <BranchNavigatorSkeleton />

  return (
    <BranchList
      repo={repo}
      branches={branches}
      highlightedBranch={highlightedBranch}
      onSelectBranch={handleSelectBranch}
      onOpenBranchStatus={handleOpenBranchStatus}
      emptyState={<EmptyState title={t(emptyLabel)} />}
    />
  )
}
