// Branch list row wrapper. Resolves `terminalBellCount` from the
// terminal-session store and delegates rendering to BranchRow. Shared
// between the persistent BranchNavigator pane and the focus-mode
// BranchListPopover so the row behavior stays in lockstep.

import { BranchRow, type BranchRowProps } from '#/web/components/branch-navigator/BranchRow.tsx'
import { worktreeTerminalKey } from '#/web/components/terminal/terminal-session-keys.ts'
import { useWorktreeTerminalBellCount } from '#/web/components/terminal/terminal-session-store.ts'

export function BranchListRow(props: BranchRowProps) {
  const terminalKey = props.branch.worktree?.path
    ? worktreeTerminalKey(props.repo.id, props.branch.worktree.path)
    : null
  const terminalBellCount = useWorktreeTerminalBellCount(terminalKey)
  return <BranchRow {...props} terminalBellCount={terminalBellCount} />
}
