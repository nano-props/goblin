import { type RefObject } from 'react'
import type { RepoBranchState } from '#/web/stores/workspaces/types.ts'
import { BranchActionsMenu } from '#/web/components/BranchActionsMenu.tsx'
import { BranchSummaryInline } from '#/web/components/repo-workspace/BranchSummaryInline.tsx'
import { cn } from '#/web/lib/cn.ts'
import type { BranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { TerminalBellBadge } from '#/web/components/terminal/TerminalBellBadge.tsx'
import { TerminalOutputActivityIndicator } from '#/web/components/terminal/TerminalOutputActivityIndicator.tsx'
import { BRANCH_ROW_ACTION_BOX_CLASS } from '#/web/components/branch-navigator/branch-row-metrics.ts'
import { NavigatorRow } from '#/web/components/branch-navigator/NavigatorRow.tsx'

export interface BranchRowProps {
  repo: BranchActionRepo
  branch: RepoBranchState
  selected: string | null
  onSelectBranch: (branch: string) => void
  onOpenBranchStatus: (branch: string) => void
  selectedRef: RefObject<HTMLLIElement | null>
  actionMenuOpen?: boolean
  onActionMenuOpenChange?: (open: boolean) => void
  terminalBellCount?: number
  terminalOutputActive?: boolean
  /**
   * Whether a branch action (queued or running) currently targets this
   * row. Resolved by the data-binding wrapper (`BranchListRow`) from
   * `branchActionDisplayPhase` so the row stays purely presentational
   * and can be reused in contexts that don't carry a live operations
   * state. Defaults to `false` when the wrapper doesn't compute it.
   */
  branchActionBusy?: boolean
}

export function BranchRow({
  repo,
  branch,
  selected,
  onSelectBranch,
  onOpenBranchStatus,
  selectedRef,
  actionMenuOpen,
  onActionMenuOpenChange,
  terminalBellCount = 0,
  terminalOutputActive = false,
  branchActionBusy = false,
}: BranchRowProps) {
  const isSelected = branch.name === selected
  const compact = useIsCompactUi()
  // The action affordance only appears on hover/focus in non-compact
  // mode. Keep it visible while the row's own branch action is busy so
  // the spinner stays anchored to the menu button the user just
  // clicked, instead of fading out from under the in-flight action.
  const isActionsHidden = !compact && !actionMenuOpen && !branchActionBusy
  const leadingTerminalBellCount = compact ? terminalBellCount : 0
  const showTerminalOutputActive = !isSelected && terminalOutputActive
  // Compact rows have a single leading status slot. Bell and sustained
  // terminal output intentionally take that slot over the worktree/dirty
  // glyph because they are time-sensitive navigation signals in the branch
  // list, not secondary decoration.
  const leadingTerminalOutputActive = compact && terminalBellCount <= 0 && showTerminalOutputActive
  const actionTerminalBellCount = compact ? 0 : terminalBellCount
  const actionTerminalOutputActive = !compact && terminalBellCount <= 0 && showTerminalOutputActive
  const worktreeOperationTargetsRow =
    repo.branchAction.phase !== 'idle' &&
    repo.branchAction.target === branch.name &&
    (repo.branchAction.reason === 'branch:createWorktree' || repo.branchAction.reason === 'branch:removeWorktree')

  return (
    <NavigatorRow
      rowRef={isSelected ? selectedRef : undefined}
      selected={isSelected}
      onClick={() => onSelectBranch(branch.name)}
      onDoubleClick={() => onOpenBranchStatus(branch.name)}
      content={
        <BranchSummaryInline
          repo={repo}
          branch={branch}
          selected={isSelected}
          leadingTerminalBellCount={leadingTerminalBellCount}
          leadingTerminalOutputActive={leadingTerminalOutputActive}
          worktreeIconDirty={worktreeOperationTargetsRow ? false : undefined}
        />
      }
      actions={
        <BranchRowActionSlot
          repo={repo}
          branch={branch}
          actionMenuOpen={actionMenuOpen}
          onActionMenuOpenChange={onActionMenuOpenChange}
          actionHidden={isActionsHidden}
          terminalBellCount={actionTerminalBellCount}
          terminalOutputActive={actionTerminalOutputActive}
        />
      }
    />
  )
}

function BranchRowActionSlot({
  repo,
  branch,
  actionMenuOpen,
  onActionMenuOpenChange,
  actionHidden,
  terminalBellCount,
  terminalOutputActive,
}: Pick<BranchRowProps, 'repo' | 'branch' | 'actionMenuOpen' | 'onActionMenuOpenChange'> & {
  actionHidden: boolean
  terminalBellCount: number
  terminalOutputActive: boolean
}) {
  const showBellBadge = terminalBellCount > 0 && actionHidden
  const showOutputActivity = terminalOutputActive && actionHidden && !showBellBadge

  return (
    <div className={BRANCH_ROW_ACTION_BOX_CLASS}>
      {showBellBadge && (
        <div className="absolute inset-0 flex items-center justify-center transition-opacity duration-100 group-hover:opacity-0 group-focus-within:opacity-0">
          <TerminalBellBadge count={terminalBellCount} />
        </div>
      )}
      {showOutputActivity && (
        <div className="absolute inset-0 flex items-center justify-center transition-opacity duration-100 group-hover:opacity-0 group-focus-within:opacity-0">
          <TerminalOutputActivityIndicator />
        </div>
      )}
      <div
        className={cn(
          'relative',
          !actionHidden && 'pointer-events-auto',
          actionHidden &&
            'pointer-events-none opacity-0 transition-opacity duration-100 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100',
        )}
      >
        <BranchActionsMenu repo={repo} branch={branch} open={actionMenuOpen} onOpenChange={onActionMenuOpenChange} />
      </div>
    </div>
  )
}
