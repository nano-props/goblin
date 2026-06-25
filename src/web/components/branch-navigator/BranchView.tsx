// Single source of truth for the branch list. Both the persistent
// left pane (BranchNavigator) and the focus-mode hover card
// (BranchListPopover) render this same view; the difference between
// the two surfaces is captured entirely by:
//   • the outer container (pane = flex ScrollArea, popover = max-h ScrollArea in compact mode)
//   • whether clicking a row closes the surface afterwards
// The list, store subscription, action-menu wiring, and empty state
// live in one place, so the two surfaces can't drift.

import { useMemo } from 'react'
import { useT } from '#/web/stores/i18n.ts'
import { visibleBranches } from '#/web/stores/repos/branch-view-mode.ts'
import { BranchList } from '#/web/components/branch-navigator/BranchList.tsx'
import { useBranchListRepo } from '#/web/components/branch-navigator/use-branch-list-data.ts'
import { EmptyState } from '#/web/components/Layout.tsx'
import { useMainWindowNavigation } from '#/web/main-window-navigation.tsx'
import { openWorkspacePaneView } from '#/web/components/branch-workspace/open-workspace-pane-view.ts'

interface Props {
  repoId: string
  /** Run after the user picks a row. The popover uses this to close;
   *  the pane leaves it unset so selection is silent. */
  onAfterSelect?: (branch: string) => void
  /** Run after the user double-clicks a row to open its status pane.
   *  The popover closes here too; the pane leaves it silent. */
  onAfterOpenStatus?: (branch: string) => void
}

export function BranchView({ repoId, onAfterSelect, onAfterOpenStatus }: Props) {
  const t = useT()
  const navigation = useMainWindowNavigation()
  const repo = useBranchListRepo(repoId)

  const branches = useMemo(
    () =>
      repo
        ? visibleBranches({
            branches: repo.data.branches,
            viewMode: repo.ui.branchViewMode,
          })
        : [],
    [repo],
  )

  const handleSelectBranch = (branch: string) => {
    navigation.selectRepoBranch(repoId, branch)
    onAfterSelect?.(branch)
  }

  const handleOpenBranchStatus = (branchName: string) => {
    const branch = repo?.data.branches.find((candidate) => candidate.name === branchName)
    void openWorkspacePaneView({
      repoId,
      branchName,
      worktreePath: branch?.worktree?.path ?? null,
      type: 'status',
      navigation,
    })
    onAfterOpenStatus?.(branchName)
  }

  const emptyLabel = repo
    ? repo.data.branches.length === 0
      ? 'branches.empty'
      : 'branches.filter-empty'
    : 'branches.empty'

  // Highlight is the same single store field in both surfaces — read
  // it from the projection here, not via a prop, so callers can't
  // pass a stale or wrong value.
  const highlightedBranch = repo?.ui.selectedBranch ?? null

  return (
    <BranchList
      repo={repo ?? null}
      branches={branches}
      highlightedBranch={highlightedBranch}
      onSelectBranch={handleSelectBranch}
      onOpenBranchStatus={handleOpenBranchStatus}
      emptyState={<EmptyState title={t(emptyLabel)} />}
    />
  )
}
