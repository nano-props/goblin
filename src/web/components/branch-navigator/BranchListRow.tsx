// Branch list row wrapper. Resolves `terminalBellCount` from the
// terminal session projection and delegates rendering to BranchRow.

import { BranchRow, type BranchRowProps } from '#/web/components/branch-navigator/BranchRow.tsx'
import { formatTerminalFilesystemTargetKeyForPath } from '#/shared/terminal-filesystem-target-key.ts'
import {
  useTerminalFilesystemTargetOutputActive,
  useTerminalFilesystemTargetBellCount,
} from '#/web/components/terminal/terminal-session-store.ts'
import { branchActionDisplayPhase } from '#/web/hooks/branch-action-state.ts'

export function BranchListRow(props: BranchRowProps) {
  const terminalSessionId = props.branch.worktree?.path
    ? formatTerminalFilesystemTargetKeyForPath(props.repo.id, props.branch.worktree.path)
    : null
  const terminalBellCount = useTerminalFilesystemTargetBellCount(terminalSessionId)
  const terminalOutputActive = useTerminalFilesystemTargetOutputActive(terminalSessionId)
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
