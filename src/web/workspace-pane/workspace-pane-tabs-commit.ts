import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import type { TerminalUpdateWorkspaceTabsOperation } from '#/shared/terminal-types.ts'
import { terminalBridge } from '#/web/terminal.ts'
import { gblLog } from '#/web/logger.ts'
import {
  cancelWorkspacePaneTabs,
  setWorkspacePaneTabsForTargetQueryData,
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
  operation: TerminalUpdateWorkspaceTabsOperation
}

export async function commitWorkspacePaneTabs(input: CommitWorkspacePaneTabsInput): Promise<boolean> {
  return await runWorkspacePaneTabsOperation(input, async () => await commitWorkspacePaneTabsNow(input))
}

export async function updateWorkspacePaneTabs(input: UpdateWorkspacePaneTabsInput): Promise<boolean> {
  return await runWorkspacePaneTabsOperation(input, async () => await updateWorkspacePaneTabsNow(input))
}

async function commitWorkspacePaneTabsNow(input: CommitWorkspacePaneTabsInput): Promise<boolean> {
  try {
    await cancelWorkspacePaneTabs(input.repoRoot)
    const serverTabs = await replaceWorkspacePaneTabsOnServer(input)
    setWorkspacePaneTabsForTargetQueryData({
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

async function updateWorkspacePaneTabsNow(input: UpdateWorkspacePaneTabsInput): Promise<boolean> {
  try {
    await cancelWorkspacePaneTabs(input.repoRoot)
    const serverTabs = await updateWorkspacePaneTabsOnServer(input)
    setWorkspacePaneTabsForTargetQueryData({
      repoRoot: input.repoRoot,
      branchName: input.branchName,
      worktreePath: input.worktreePath,
      tabs: serverTabs,
    })
    return true
  } catch (err) {
    gblLog.warn('workspace pane tabs operation failed', {
      repoRoot: input.repoRoot,
      worktreePath: input.worktreePath,
      operation: input.operation.type,
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

export async function updateWorkspacePaneTabsOnServer(
  input: UpdateWorkspacePaneTabsInput,
): Promise<WorkspacePaneTabEntry[]> {
  return await terminalBridge.updateWorkspaceTabs({
    repoRoot: input.repoRoot,
    branchName: input.branchName,
    worktreePath: input.worktreePath,
    operation: input.operation,
  })
}
