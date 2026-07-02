import type { QueryClient } from '@tanstack/react-query'
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
  repoInstanceId: string
  branchName: string
  worktreePath: string | null
  tabs: WorkspacePaneTabEntry[]
}

export interface UpdateWorkspacePaneTabsInput {
  repoRoot: string
  repoInstanceId: string
  branchName: string
  worktreePath: string | null
  operation: TerminalUpdateWorkspaceTabsOperation
}

export type WorkspacePaneTabsMutationOperation = 'commit' | 'update' | 'reorder'

export interface WorkspacePaneTabsMutationSuccess {
  ok: true
}

export interface WorkspacePaneTabsMutationFailure {
  ok: false
  operation: WorkspacePaneTabsMutationOperation
  repoRoot: string
  branchName: string
  worktreePath: string | null
  message: string
  error: unknown
}

export type WorkspacePaneTabsMutationResult = WorkspacePaneTabsMutationSuccess | WorkspacePaneTabsMutationFailure

/**
 * Logs a workspace-pane-tabs mutation failure and returns the structured
 * failure result. Callers that wrap a public mutation API (e.g. `commit`,
 * `update`) should return the result so consumers can branch on `ok`; callers
 * that only need the log can discard it.
 */
export function reportWorkspacePaneTabsFailure(input: {
  operation: WorkspacePaneTabsMutationOperation
  repoRoot: string
  branchName: string
  worktreePath: string | null
  error: unknown
}): WorkspacePaneTabsMutationFailure {
  const message =
    input.error instanceof Error
      ? input.error.message
      : typeof input.error === 'string'
        ? input.error
        : 'workspace pane tabs operation failed'
  gblLog.warn(`workspace pane tabs ${input.operation} failed`, {
    repoRoot: input.repoRoot,
    branchName: input.branchName,
    worktreePath: input.worktreePath,
    operation: input.operation,
    message,
    error: input.error,
  })
  return {
    ok: false,
    operation: input.operation,
    repoRoot: input.repoRoot,
    branchName: input.branchName,
    worktreePath: input.worktreePath,
    message,
    error: input.error,
  }
}

export async function commitWorkspacePaneTabs(
  input: CommitWorkspacePaneTabsInput,
): Promise<WorkspacePaneTabsMutationResult> {
  return await runWorkspacePaneTabsOperation(input, async () => await commitWorkspacePaneTabsNow(input))
}

export async function updateWorkspacePaneTabs(
  input: UpdateWorkspacePaneTabsInput,
): Promise<WorkspacePaneTabsMutationResult> {
  return await runWorkspacePaneTabsOperation(input, async () => await updateWorkspacePaneTabsNow(input))
}

async function commitWorkspacePaneTabsNow(
  input: CommitWorkspacePaneTabsInput,
): Promise<WorkspacePaneTabsMutationResult> {
  try {
    await cancelWorkspacePaneTabs(input.repoRoot, input.repoInstanceId)
    const serverTabs = await replaceWorkspacePaneTabsOnServer(input)
    await writeCanonicalWorkspacePaneTabsForTarget({
      repoRoot: input.repoRoot,
      repoInstanceId: input.repoInstanceId,
      branchName: input.branchName,
      worktreePath: input.worktreePath,
      tabs: serverTabs,
    })
    return { ok: true }
  } catch (err) {
    return reportWorkspacePaneTabsFailure({
      operation: 'commit',
      repoRoot: input.repoRoot,
      branchName: input.branchName,
      worktreePath: input.worktreePath,
      error: err,
    })
  }
}

async function updateWorkspacePaneTabsNow(
  input: UpdateWorkspacePaneTabsInput,
): Promise<WorkspacePaneTabsMutationResult> {
  try {
    await cancelWorkspacePaneTabs(input.repoRoot, input.repoInstanceId)
    const serverTabs = await updateWorkspacePaneTabsOnServer(input)
    await writeCanonicalWorkspacePaneTabsForTarget({
      repoRoot: input.repoRoot,
      repoInstanceId: input.repoInstanceId,
      branchName: input.branchName,
      worktreePath: input.worktreePath,
      tabs: serverTabs,
    })
    return { ok: true }
  } catch (err) {
    return reportWorkspacePaneTabsFailure({
      operation: 'update',
      repoRoot: input.repoRoot,
      branchName: input.branchName,
      worktreePath: input.worktreePath,
      error: err,
    })
  }
}

export async function writeCanonicalWorkspacePaneTabsForTarget(
  input: CommitWorkspacePaneTabsInput,
  queryClient?: QueryClient,
): Promise<void> {
  // A list query may have started while the server write was in flight.
  // Cancel again so stale list results cannot overwrite the canonical tabs.
  await cancelWorkspacePaneTabs(input.repoRoot, input.repoInstanceId, queryClient)
  setWorkspacePaneTabsForTargetQueryData(input, queryClient)
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
    repoInstanceId: input.repoInstanceId,
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
    repoInstanceId: input.repoInstanceId,
    branchName: input.branchName,
    worktreePath: input.worktreePath,
    operation: input.operation,
  })
}
