import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import { terminalBridge } from '#/web/terminal.ts'
import { gblLog } from '#/web/logger.ts'
import {
  cancelWorkspacePaneTabs,
  fetchWorkspacePaneTabsForBranch,
  setWorkspacePaneTabsForBranchQueryData,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { runWorkspacePaneTabsOperation } from '#/web/workspace-pane/workspace-pane-tabs-operation-queue.ts'

export interface CommitWorkspacePaneTabsInput {
  repoRoot: string
  branchName: string
  worktreePath: string | null
  tabs: WorkspacePaneTabEntry[]
}

export interface UpdateWorkspacePaneTabsInput {
  repoRoot: string
  branchName: string
  worktreePath: string | null
  update: (currentTabs: WorkspacePaneTabEntry[]) => readonly WorkspacePaneTabEntry[]
}

export async function commitWorkspacePaneTabs(input: CommitWorkspacePaneTabsInput): Promise<boolean> {
  return await runWorkspacePaneTabsOperation(input, async () => await commitWorkspacePaneTabsNow(input))
}

export async function updateWorkspacePaneTabs(input: UpdateWorkspacePaneTabsInput): Promise<boolean> {
  return await runWorkspacePaneTabsOperation(input, async () => {
    const currentTabs = await fetchWorkspacePaneTabsForBranch({
      repoRoot: input.repoRoot,
      branchName: input.branchName,
    })
    return await commitWorkspacePaneTabsNow({
      repoRoot: input.repoRoot,
      branchName: input.branchName,
      worktreePath: input.worktreePath,
      tabs: [...input.update(currentTabs)],
    })
  })
}

async function commitWorkspacePaneTabsNow(input: CommitWorkspacePaneTabsInput): Promise<boolean> {
  try {
    await cancelWorkspacePaneTabs(input.repoRoot)
    const serverTabs = await replaceWorkspacePaneTabsOnServer(input)
    setWorkspacePaneTabsForBranchQueryData({
      repoRoot: input.repoRoot,
      branchName: input.branchName,
      worktreePath: input.worktreePath,
      tabs: serverTabs,
    })
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

/**
 * Low-level full-list server replace. User-facing tab operations should run
 * through runWorkspacePaneTabsOperation before calling this.
 */
export async function replaceWorkspacePaneTabsOnServer(
  input: CommitWorkspacePaneTabsInput,
): Promise<WorkspacePaneTabEntry[]> {
  return await terminalBridge.replaceWorkspaceTabs({
    repoRoot: input.repoRoot,
    branchName: input.branchName,
    worktreePath: input.worktreePath,
    tabs: input.tabs,
  })
}
