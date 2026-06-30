import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import { terminalBridge } from '#/web/terminal.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { gblLog } from '#/web/logger.ts'

interface CommitWorkspacePaneTabsInput {
  repoRoot: string
  branchName: string
  worktreePath: string | null
  tabs: WorkspacePaneTabEntry[]
}

export async function commitWorkspacePaneTabs(input: CommitWorkspacePaneTabsInput): Promise<boolean> {
  if (!input.worktreePath) {
    useReposStore.getState().replaceWorkspacePaneTabs(input.repoRoot, input.tabs, input.branchName)
    return true
  }

  try {
    const serverTabs = await terminalBridge.replaceWorkspaceTabs({
      repoRoot: input.repoRoot,
      worktreePath: input.worktreePath,
      tabs: input.tabs,
    })
    useReposStore.getState().replaceWorkspacePaneTabs(input.repoRoot, serverTabs, input.branchName)
    return true
  } catch (err) {
    gblLog.warn('workspace pane tabs commit failed', {
      repoRoot: input.repoRoot,
      worktreePath: input.worktreePath,
      err,
    })
    return false
  }
}
