// Branch list row wrapper. Resolves `terminalBellCount` from the
// terminal session projection and delegates rendering to BranchRow.

import { BranchRow, type BranchRowProps } from '#/web/components/branch-navigator/BranchRow.tsx'
import { formatTerminalWorktreeKey } from '#/shared/terminal-workspace-slot-key.ts'
import {
  useTerminalWorktreeActive,
  useTerminalWorktreeBellCount,
} from '#/web/components/terminal/terminal-session-store.ts'
import { branchActionDisplayPhase } from '#/web/hooks/branch-action-state.ts'

export function BranchListRow(props: BranchRowProps) {
  const terminalKey = props.branch.worktree?.path
    ? formatTerminalWorktreeKey(props.repo.id, props.branch.worktree.path)
    : null
  const terminalBellCount = useTerminalWorktreeBellCount(terminalKey)
  const terminalActive = useTerminalWorktreeActive(terminalKey)
  const branchActionBusy = branchActionDisplayPhase(props.repo, props.branch.name) !== null
  return (
    <BranchRow
      {...props}
      terminalBellCount={terminalBellCount}
      terminalActive={terminalActive}
      branchActionBusy={branchActionBusy}
    />
  )
}
