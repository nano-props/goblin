// Branch list row wrapper. Resolves `terminalBellCount` from the
// terminal session projection and delegates rendering to BranchRow.

import { computed, defineComponent } from 'vue'
import type { PropType } from 'vue'
import { BranchRow } from '#/web/components/branch-navigator/BranchRow.tsx'
import type { BranchRowProps } from '#/web/components/branch-navigator/BranchRow.tsx'
import type { BranchSnapshotInfo } from '#/shared/git-types.ts'
import { formatTerminalFilesystemTargetKeyForPath } from '#/shared/terminal-filesystem-target-key.ts'
import {
  useTerminalFilesystemTargetOutputActive,
  useTerminalFilesystemTargetBellCount,
} from '#/web/components/terminal/terminal-session-store.ts'
import { branchActionDisplayPhase } from '#/web/hooks/branch-action-state.ts'
import type { BranchActionRepo } from '#/web/hooks/branch-action-state.ts'

export const BranchListRow = defineComponent<BranchRowProps>({
  name: 'BranchListRow',
  props: {
    repo: { type: Object as PropType<BranchActionRepo>, required: true },
    branch: { type: Object as PropType<BranchSnapshotInfo>, required: true },
    selected: { type: String, default: null },
    onSelectBranch: { type: Function as PropType<(branch: string) => void>, required: true },
    onOpenBranchStatus: { type: Function as PropType<(branch: string) => void>, required: true },
    selectedRef: { type: null, required: true },
    actionMenuOpen: Boolean,
    onActionMenuOpenChange: Function as PropType<(open: boolean) => void>,
  },

  setup(props) {
    const terminalSessionId = computed(() =>
      props.branch.worktree?.path
        ? formatTerminalFilesystemTargetKeyForPath(props.repo.id, props.branch.worktree.path)
        : null,
    )
    const terminalBellCount = useTerminalFilesystemTargetBellCount(terminalSessionId)
    const terminalOutputActive = useTerminalFilesystemTargetOutputActive(terminalSessionId)

    return () => (
      <BranchRow
        repo={props.repo}
        branch={props.branch}
        selected={props.selected}
        onSelectBranch={props.onSelectBranch}
        onOpenBranchStatus={props.onOpenBranchStatus}
        selectedRef={props.selectedRef}
        actionMenuOpen={props.actionMenuOpen}
        onActionMenuOpenChange={props.onActionMenuOpenChange}
        terminalBellCount={terminalBellCount.value}
        terminalOutputActive={terminalOutputActive.value}
        branchActionBusy={branchActionDisplayPhase(props.repo, props.branch.name) !== null}
      />
    )
  },
})
