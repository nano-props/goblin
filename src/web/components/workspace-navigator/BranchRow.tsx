import { defineComponent } from 'vue'
import type { FunctionalComponent, PropType } from 'vue'
import type { BranchSnapshotInfo, RepoWorktreeSnapshot } from '#/shared/git-types.ts'
import { BranchActionsMenu } from '#/web/components/BranchActionsMenu.tsx'
import { BranchSummaryInline } from '#/web/components/repo-workspace/BranchSummaryInline.tsx'
import { cn } from '#/web/lib/cn.ts'
import type { BranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { TerminalBellBadge } from '#/web/components/terminal/TerminalBellBadge.tsx'
import { TerminalOutputActivityIndicator } from '#/web/components/terminal/TerminalOutputActivityIndicator.tsx'
import { NAVIGATOR_ROW_ACTION_BOX_CLASS } from '#/web/components/workspace-navigator/navigator-row-metrics.ts'
import { NavigatorRow } from '#/web/components/workspace-navigator/NavigatorRow.tsx'
import type { ElementRef } from '#/web/components/ui/refs.ts'

export interface BranchRowProps {
  repo: BranchActionRepo
  branch: BranchSnapshotInfo
  worktree?: RepoWorktreeSnapshot
  selected: string | null
  onSelectBranch: (branch: string) => void
  onOpenBranchStatus: (branch: string) => void
  selectedRef: ElementRef<HTMLLIElement>
  actionMenuOpen?: boolean
  onActionMenuOpenChange?: (open: boolean) => void
  terminalBellCount?: number
  terminalOutputActive?: boolean
  /**
   * Whether a branch action (queued or running) currently targets this
   * row. Resolved by the data-binding wrapper (`GitWorkspaceNavigatorBranchRow`) from
   * `branchActionDisplayPhase` so the row stays purely presentational
   * and can be reused in contexts that don't carry a live operations
   * state. Defaults to `false` when the wrapper doesn't compute it.
   */
  branchActionBusy?: boolean
}

export const BranchRow = defineComponent<BranchRowProps>({
  name: 'BranchRow',
  props: {
    repo: { type: Object as PropType<BranchActionRepo>, required: true },
    branch: { type: Object as PropType<BranchSnapshotInfo>, required: true },
    worktree: { type: Object as PropType<RepoWorktreeSnapshot>, default: undefined },
    selected: { type: String, default: null },
    onSelectBranch: { type: Function as PropType<(branch: string) => void>, required: true },
    onOpenBranchStatus: { type: Function as PropType<(branch: string) => void>, required: true },
    selectedRef: { type: null, required: true },
    actionMenuOpen: Boolean,
    onActionMenuOpenChange: Function as PropType<(open: boolean) => void>,
    terminalBellCount: { type: Number, default: 0 },
    terminalOutputActive: Boolean,
    branchActionBusy: Boolean,
  },

  setup(props) {
    const compact = useIsCompactUi()

    return () => {
      const isSelected = props.branch.name === props.selected
      // The action affordance only appears on hover/focus in non-compact
      // mode. Keep it visible while this row's action is busy.
      const actionHidden = !compact.value && !props.actionMenuOpen && !props.branchActionBusy
      const leadingTerminalBellCount = compact.value ? (props.terminalBellCount ?? 0) : 0
      const showTerminalOutputActive = !isSelected && !!props.terminalOutputActive
      const leadingTerminalOutputActive =
        compact.value && (props.terminalBellCount ?? 0) <= 0 && showTerminalOutputActive
      const actionTerminalBellCount = compact.value ? 0 : (props.terminalBellCount ?? 0)
      const actionTerminalOutputActive =
        !compact.value && (props.terminalBellCount ?? 0) <= 0 && showTerminalOutputActive
      const worktreeOperationTargetsRow =
        props.repo.branchAction.phase !== 'idle' &&
        props.repo.branchAction.target === props.branch.name &&
        (props.repo.branchAction.reason === 'branch:createWorktree' ||
          props.repo.branchAction.reason === 'branch:removeWorktree')

      return (
        <NavigatorRow
          rowRef={isSelected ? props.selectedRef : undefined}
          selected={isSelected}
          onClick={() => props.onSelectBranch(props.branch.name)}
          onDblclick={() => props.onOpenBranchStatus(props.branch.name)}
          content={
            <BranchSummaryInline
              repo={props.repo}
              branch={props.branch}
              worktree={props.worktree}
              selected={isSelected}
              leadingTerminalBellCount={leadingTerminalBellCount}
              leadingTerminalOutputActive={leadingTerminalOutputActive}
              worktreeIconDirty={worktreeOperationTargetsRow ? false : undefined}
            />
          }
          actions={
            <BranchRowActionSlot
              repo={props.repo}
              branch={props.branch}
              actionMenuOpen={props.actionMenuOpen}
              onActionMenuOpenChange={props.onActionMenuOpenChange}
              actionHidden={actionHidden}
              terminalBellCount={actionTerminalBellCount}
              terminalOutputActive={actionTerminalOutputActive}
            />
          }
        />
      )
    }
  },
})

type BranchRowActionSlotProps = Pick<
  BranchRowProps,
  'repo' | 'branch' | 'actionMenuOpen' | 'onActionMenuOpenChange'
> & {
  actionHidden: boolean
  terminalBellCount: number
  terminalOutputActive: boolean
}

const BranchRowActionSlot: FunctionalComponent<BranchRowActionSlotProps> = (props) => {
  const showBellBadge = props.terminalBellCount > 0 && props.actionHidden
  const showOutputActivity = props.terminalOutputActive && props.actionHidden && !showBellBadge

  return (
    <div class={NAVIGATOR_ROW_ACTION_BOX_CLASS}>
      {showBellBadge && (
        <div class="absolute inset-0 flex items-center justify-center transition-opacity duration-100 group-hover:opacity-0 group-focus-within:opacity-0">
          <TerminalBellBadge count={props.terminalBellCount} />
        </div>
      )}
      {showOutputActivity && (
        <div class="absolute inset-0 flex items-center justify-center transition-opacity duration-100 group-hover:opacity-0 group-focus-within:opacity-0">
          <TerminalOutputActivityIndicator />
        </div>
      )}
      <div
        class={cn(
          'relative',
          !props.actionHidden && 'pointer-events-auto',
          props.actionHidden &&
            'pointer-events-none opacity-0 transition-opacity duration-100 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100',
        )}
      >
        <BranchActionsMenu
          repo={props.repo}
          branch={props.branch}
          open={props.actionMenuOpen}
          onOpenChange={props.onActionMenuOpenChange}
        />
      </div>
    </div>
  )
}

BranchRowActionSlot.props = [
  'repo',
  'branch',
  'actionMenuOpen',
  'onActionMenuOpenChange',
  'actionHidden',
  'terminalBellCount',
  'terminalOutputActive',
]
