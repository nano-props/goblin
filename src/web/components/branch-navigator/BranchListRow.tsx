// Branch list row wrapper. Resolves `terminalBellCount` from the
// terminal session projection and delegates rendering to BranchRow.

import { BranchRow, type BranchRowProps } from '#/web/components/branch-navigator/BranchRow.tsx'
import { formatTerminalWorktreeKeyForPath } from '#/shared/terminal-worktree-key.ts'
import {
  useTerminalWorktreeOutputActive,
  useTerminalWorktreeBellCount,
} from '#/web/components/terminal/terminal-session-store.ts'
import { branchActionDisplayPhase } from '#/web/hooks/branch-action-state.ts'

export function BranchListRow(props: BranchRowProps) {
  const terminalSessionId = props.branch.worktree?.path
    ? formatTerminalWorktreeKeyForPath(props.repo.id, props.branch.worktree.path)
    : null
  const terminalBellCount = useTerminalWorktreeBellCount(terminalSessionId)
  const terminalOutputActive = useTerminalWorktreeOutputActive(terminalSessionId)
  const branchActionBusy = branchActionDisplayPhase(props.repo, props.branch.name) !== null
  return (
    <BranchRow
      {...props}
      terminalBellCount={terminalBellCount}
      terminalOutputActive={terminalOutputActive}
      branchActionBusy={branchActionBusy}
    />
  )
}
