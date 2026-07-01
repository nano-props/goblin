import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import { terminalBridge } from '#/web/terminal.ts'
import { gblLog } from '#/web/logger.ts'
import {
  cancelWorkspacePaneTabs,
  invalidateWorkspacePaneTabs,
  setWorkspacePaneTabsForBranchQueryData,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'

interface CommitWorkspacePaneTabsInput {
  repoRoot: string
  branchName: string
  worktreePath: string | null
  tabs: WorkspacePaneTabEntry[]
  optimistic?: boolean
}

export async function commitWorkspacePaneTabs(input: CommitWorkspacePaneTabsInput): Promise<boolean> {
  if (input.optimistic) {
    void cancelWorkspacePaneTabs(input.repoRoot)
    setWorkspacePaneTabsForBranchQueryData({
      repoRoot: input.repoRoot,
      branchName: input.branchName,
      worktreePath: input.worktreePath,
      tabs: input.tabs,
    })
  }
  try {
    const serverTabs = await terminalBridge.replaceWorkspaceTabs({
      repoRoot: input.repoRoot,
      branchName: input.branchName,
      worktreePath: input.worktreePath,
      tabs: input.tabs,
    })
    setWorkspacePaneTabsForBranchQueryData({
      repoRoot: input.repoRoot,
      branchName: input.branchName,
      worktreePath: input.worktreePath,
      tabs: serverTabs,
    })
    return true
  } catch (err) {
    if (input.optimistic) invalidateWorkspacePaneTabs(input.repoRoot)
    gblLog.warn('workspace pane tabs commit failed', {
      repoRoot: input.repoRoot,
      worktreePath: input.worktreePath,
      err,
    })
    return false
  }
}
