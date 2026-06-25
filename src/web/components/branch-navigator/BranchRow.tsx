import { type RefObject } from 'react'
import type { RepoBranchState } from '#/web/stores/repos/types.ts'
import { BranchActionsMenu } from '#/web/components/BranchActionsMenu.tsx'
import { BranchSummaryInline } from '#/web/components/repo-workspace/BranchSummaryInline.tsx'
import { cn } from '#/web/lib/cn.ts'
import type { BranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { TerminalBellBadge } from '#/web/components/terminal/TerminalBellBadge.tsx'

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
  const actionTerminalBellCount = compact ? 0 : terminalBellCount

  return (
    <li
      ref={isSelected ? selectedRef : undefined}
      onClick={() => onSelectBranch(branch.name)}
      onDoubleClick={() => onOpenBranchStatus(branch.name)}
      className={cn(
        'group relative grid min-h-9 grid-cols-[minmax(0,1fr)_auto] items-stretch rounded-md cursor-pointer',
        'transition-colors duration-100',
        isSelected ? 'bg-selected text-selected-foreground hover:bg-selected' : 'hover:bg-muted',
      )}
    >
      <div className="pointer-events-none relative z-10 flex min-w-0 items-center px-4 py-1.5">
        <BranchSummaryInline
          repo={repo}
          branch={branch}
          selected={isSelected}
          leadingTerminalBellCount={leadingTerminalBellCount}
        />
      </div>
      <BranchRowActionSlot
        repo={repo}
        branch={branch}
        actionMenuOpen={actionMenuOpen}
        onActionMenuOpenChange={onActionMenuOpenChange}
        actionHidden={isActionsHidden}
        terminalBellCount={actionTerminalBellCount}
      />
    </li>
  )
}

function BranchRowActionSlot({
  repo,
  branch,
  actionMenuOpen,
  onActionMenuOpenChange,
  actionHidden,
  terminalBellCount,
}: Pick<BranchRowProps, 'repo' | 'branch' | 'actionMenuOpen' | 'onActionMenuOpenChange'> & {
  actionHidden: boolean
  terminalBellCount: number
}) {
  const showBellBadge = terminalBellCount > 0 && actionHidden

  return (
    <div className="pointer-events-none relative z-20 flex shrink-0 items-center py-1.5 pr-4">
      <div className="relative flex h-6 min-w-6 items-center justify-center">
        {showBellBadge && (
          <div className="absolute inset-0 flex items-center justify-center transition-opacity duration-100 group-hover:opacity-0 group-focus-within:opacity-0">
            <TerminalBellBadge count={terminalBellCount} />
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
    </div>
  )
}
