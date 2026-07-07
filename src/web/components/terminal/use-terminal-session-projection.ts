import { useState } from 'react'
import {
  getTerminalSessionProjection,
  type TerminalSessionProjection,
} from '#/web/components/terminal/TerminalSessionProjection.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { setWorkspacePaneTabsForTargetQueryData } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'

export function useTerminalSessionProjection(): TerminalSessionProjection {
  const setSelectedTerminal = useReposStore((s) => s.setSelectedTerminal)
  const [projection] = useState(() =>
    getTerminalSessionProjection({
      onSelectedWorktreeChange: setSelectedTerminal,
      onWorkspaceTabsChanged: (base, tabs) => {
        if (typeof base.repoInstanceId !== 'string') return
        setWorkspacePaneTabsForTargetQueryData({
          repoRoot: base.repoRoot,
          repoInstanceId: base.repoInstanceId,
          branchName: base.branch,
          worktreePath: base.worktreePath,
          tabs,
        })
      },
    }),
  )
  return projection
}
