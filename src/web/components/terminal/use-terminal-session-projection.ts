import { useState } from 'react'
import {
  getTerminalSessionProjection,
  type TerminalSessionProjection,
} from '#/web/components/terminal/TerminalSessionProjection.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { writeCanonicalWorkspacePaneTabsForTarget } from '#/web/workspace-pane/workspace-pane-tabs-commit.ts'

export function useTerminalSessionProjection(): TerminalSessionProjection {
  const setSelectedTerminal = useReposStore((s) => s.setSelectedTerminal)
  const [projection] = useState(() =>
    getTerminalSessionProjection({
      onSelectedWorktreeChange: setSelectedTerminal,
      onWorkspaceTabsChanged: async (base, tabs) => {
        if (typeof base.repoInstanceId !== 'string') return false
        return await writeCanonicalWorkspacePaneTabsForTarget({
          repoRoot: base.repoRoot,
          repoInstanceId: base.repoInstanceId,
          branchName: base.branch,
          worktreePath: base.worktreePath,
          tabs: [...tabs],
        })
      },
    }),
  )
  return projection
}
