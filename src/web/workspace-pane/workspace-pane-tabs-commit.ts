import type { QueryClient } from '@tanstack/query-core'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import type {
  WorkspacePaneTabsSnapshot,
  WorkspacePaneTabsUpdateOperation,
  WorkspacePaneTabsWriteResult,
} from '#/shared/workspace-pane-tabs.ts'
import { goblinLog } from '#/web/logger.ts'
import { currentWorkspaceRuntimeId } from '#/web/stores/workspaces/workspace-guards.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import {
  readWorkspacePaneTabsForTarget,
  workspacePaneTabsForTargetFromQueryData,
  writeWorkspacePaneTabsSnapshotQueryData,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { workspacePaneTabsClient } from '#/web/workspace-pane/workspace-pane-tabs-client.ts'
import {
  runtimeWorkspacePaneTarget,
  workspacePaneTabsBranchIdentity,
  workspacePaneTabsTargetIdentityKey,
  workspacePaneTabsTargetWorktreePath,
  type WorkspacePaneTabsTarget,
} from '#/shared/workspace-pane-tabs-target.ts'

type WorkspacePaneTabsMutationTarget = WorkspacePaneTabsTarget & {
  workspaceRuntimeId: string
}

export type UpdateWorkspacePaneTabsInput = WorkspacePaneTabsMutationTarget & {
  operation: WorkspacePaneTabsUpdateOperation
}

export type WorkspacePaneTabsMutationOperation = 'update' | 'reorder'

export interface WorkspacePaneTabsMutationSuccess {
  ok: true
  projection: 'applied' | 'superseded' | 'failed'
}

export interface WorkspacePaneTabsMutationFailure {
  ok: false
  operation: WorkspacePaneTabsMutationOperation
  workspaceId: WorkspaceId
  branchName: string | null
  worktreePath: string | null
  message: string
  error: unknown
  canceled?: boolean
}

export type WorkspacePaneTabsMutationResult = WorkspacePaneTabsMutationSuccess | WorkspacePaneTabsMutationFailure

export type WorkspacePaneTabsSnapshotCommit = 'applied' | 'newer-snapshot-preserved' | 'scope-rejected'

type WorkspacePaneTabsInteractionTarget = WorkspacePaneTabsTarget

function createWorkspacePaneTabsInteractionBlocker() {
  const blockedCountsByTarget = new Map<string, number>()

  function acquire(input: WorkspacePaneTabsInteractionTarget): () => void {
    const key = workspacePaneTabsTargetIdentityKey(input)
    blockedCountsByTarget.set(key, (blockedCountsByTarget.get(key) ?? 0) + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      const nextCount = (blockedCountsByTarget.get(key) ?? 1) - 1
      if (nextCount > 0) blockedCountsByTarget.set(key, nextCount)
      else blockedCountsByTarget.delete(key)
    }
  }

  return {
    isBlocked(input: WorkspacePaneTabsInteractionTarget): boolean {
      const key = workspacePaneTabsTargetIdentityKey(input)
      return (blockedCountsByTarget.get(key) ?? 0) > 0
    },
    async run<T>(
      input: WorkspacePaneTabsInteractionTarget,
      blocksInteraction: boolean,
      task: () => Promise<T>,
    ): Promise<T> {
      const release = blocksInteraction ? acquire(input) : null
      try {
        return await task()
      } finally {
        release?.()
      }
    },
  }
}

const workspacePaneTabsInteractionBlocker = createWorkspacePaneTabsInteractionBlocker()

/**
 * Logs a workspace-pane-tabs mutation failure and returns the structured
 * failure result. Callers that wrap a public mutation API should return the
 * result so consumers can branch on `ok`; callers
 * that only need the log can discard it.
 */
export function reportWorkspacePaneTabsFailure(input: {
  operation: WorkspacePaneTabsMutationOperation
  workspaceId: WorkspaceId
  branchName: string | null
  worktreePath: string | null
  error: unknown
}): WorkspacePaneTabsMutationFailure {
  const message =
    input.error instanceof Error
      ? input.error.message
      : typeof input.error === 'string'
        ? input.error
        : 'workspace pane tabs operation failed'
  goblinLog.warn(`workspace pane tabs ${input.operation} failed`, {
    workspaceId: input.workspaceId,
    branchName: input.branchName,
    worktreePath: input.worktreePath,
    operation: input.operation,
    message,
    error: input.error,
  })
  return {
    ok: false,
    operation: input.operation,
    workspaceId: input.workspaceId,
    branchName: input.branchName,
    worktreePath: input.worktreePath,
    message,
    error: input.error,
  }
}

export async function updateWorkspacePaneTabs(
  input: UpdateWorkspacePaneTabsInput,
): Promise<WorkspacePaneTabsMutationResult> {
  return await workspacePaneTabsInteractionBlocker.run(
    input,
    workspacePaneTabsUpdateBlocksInteraction(input.operation),
    () => updateWorkspacePaneTabsNow(input),
  )
}

export function workspacePaneTabsInteractionBlockedForTarget(input: WorkspacePaneTabsTarget): boolean {
  return workspacePaneTabsInteractionBlocker.isBlocked(input)
}

function workspacePaneTabsUpdateBlocksInteraction(operation: WorkspacePaneTabsUpdateOperation): boolean {
  return operation.type !== 'open-static'
}

async function updateWorkspacePaneTabsNow(
  input: UpdateWorkspacePaneTabsInput,
): Promise<WorkspacePaneTabsMutationResult> {
  try {
    const result = await updateWorkspacePaneTabsOnServer(input)
    if (result.kind === 'committed-projection-failed') return { ok: true, projection: 'failed' }
    const projection = writeCanonicalWorkspacePaneTabsSnapshot(
      input.workspaceId,
      input.workspaceRuntimeId,
      result.snapshot,
    )
    return {
      ok: true,
      projection: workspacePaneTabsSnapshotCommitPreservesOperation(projection, input, result.snapshot)
        ? 'applied'
        : 'superseded',
    }
  } catch (err) {
    return reportWorkspacePaneTabsFailure({
      operation: 'update',
      workspaceId: input.workspaceId,
      branchName: workspacePaneTabsBranchIdentity(input),
      worktreePath: workspacePaneTabsTargetWorktreePath(input),
      error: err,
    })
  }
}

export function writeCanonicalWorkspacePaneTabsSnapshot(
  workspaceId: WorkspaceId,
  workspaceRuntimeId: string,
  snapshot: WorkspacePaneTabsSnapshot,
  queryClient?: QueryClient,
): WorkspacePaneTabsSnapshotCommit {
  if (!workspacePaneTabsProjectionScopeAccepted({ workspaceId, workspaceRuntimeId })) return 'scope-rejected'
  return writeWorkspacePaneTabsSnapshotQueryData(workspaceId, workspaceRuntimeId, snapshot, queryClient)
    ? 'applied'
    : 'newer-snapshot-preserved'
}

export function workspacePaneTabsAfterSnapshotCommit(
  commit: WorkspacePaneTabsSnapshotCommit,
  target: WorkspacePaneTabsMutationTarget,
  snapshot: WorkspacePaneTabsSnapshot,
  queryClient?: QueryClient,
): WorkspacePaneTabEntry[] | null {
  if (commit === 'scope-rejected') return null
  return commit === 'applied'
    ? workspacePaneTabsForTargetFromQueryData(snapshot, target)
    : readWorkspacePaneTabsForTarget(target, queryClient)
}

function workspacePaneTabsSnapshotCommitPreservesOperation(
  commit: WorkspacePaneTabsSnapshotCommit,
  input: UpdateWorkspacePaneTabsInput,
  snapshot: WorkspacePaneTabsSnapshot,
): boolean {
  const tabs = workspacePaneTabsAfterSnapshotCommit(commit, input, snapshot)
  if (!tabs) return false
  const operation = input.operation
  if (operation.type === 'reorder') return true
  const containsTab = tabs.some((tab) => tab.type === operation.tabType)
  return operation.type === 'open-static' ? containsTab : !containsTab
}

export async function updateWorkspacePaneTabsOnServer(
  input: UpdateWorkspacePaneTabsInput,
): Promise<WorkspacePaneTabsWriteResult> {
  const target = runtimeWorkspacePaneTarget(input, input.workspaceRuntimeId)
  if (!target) throw new Error('error.workspace-tabs-target-invalid')
  return await workspacePaneTabsClient.update({
    workspaceId: input.workspaceId,
    workspaceRuntimeId: input.workspaceRuntimeId,
    target,
    operation: input.operation,
  })
}

function workspacePaneTabsProjectionScopeAccepted(input: {
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
}): boolean {
  return currentWorkspaceRuntimeId(workspacesStore.getState(), input.workspaceId) === input.workspaceRuntimeId
}
