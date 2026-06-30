// Branch list row wrapper. Resolves `terminalBellCount` from the
// terminal session projection and delegates rendering to BranchRow.

import { BranchRow, type BranchRowProps } from '#/web/components/branch-navigator/BranchRow.tsx'
import { worktreeTerminalKey } from '#/web/components/terminal/terminal-workspace-slot-keys.ts'
import {
  useWorktreeTerminalActive,
  useWorktreeTerminalBellCount,
} from '#/web/components/terminal/terminal-session-store.ts'
import { branchActionDisplayPhase } from '#/web/hooks/branch-action-state.ts'

export function BranchListRow(props: BranchRowProps) {
  const terminalKey = props.branch.worktree?.path
    ? worktreeTerminalKey(props.repo.id, props.branch.worktree.path)
    : null
  const terminalBellCount = useWorktreeTerminalBellCount(terminalKey)
  const terminalActive = useWorktreeTerminalActive(terminalKey)
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
