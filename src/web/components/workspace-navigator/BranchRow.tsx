import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import type { BranchSnapshotInfo, RepoWorktreeSnapshot } from '#/shared/git-types.ts'
import { BranchActionsMenu } from '#/web/components/BranchActionsMenu.tsx'
import { BranchSummaryInline } from '#/web/components/repo-workspace/BranchSummaryInline.tsx'
import type { BranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { NavigatorRow } from '#/web/components/workspace-navigator/NavigatorRow.tsx'
import { NavigatorRowActionSlot } from '#/web/components/workspace-navigator/NavigatorRowActionSlot.tsx'
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
            <NavigatorRowActionSlot
              actionHidden={actionHidden}
              terminalBellCount={actionTerminalBellCount}
              terminalOutputActive={actionTerminalOutputActive}
              action={
                <BranchActionsMenu
                  repo={props.repo}
                  branch={props.branch}
                  open={props.actionMenuOpen}
                  onOpenChange={props.onActionMenuOpenChange}
                />
              }
            />
          }
        />
      )
    }
  },
})
