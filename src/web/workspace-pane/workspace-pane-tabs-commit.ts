import type { QueryClient } from '@tanstack/react-query'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabsSnapshot, WorkspacePaneTabsUpdateOperation } from '#/shared/workspace-pane-tabs.ts'
import { goblinLog } from '#/web/logger.ts'
import { currentRepoRuntimeId } from '#/web/stores/repos/repo-guards.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { writeWorkspacePaneTabsSnapshotQueryData } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { workspacePaneTabsClient } from '#/web/workspace-pane/workspace-pane-tabs-client.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'

export interface CommitWorkspacePaneTabsInput {
  repoRoot: string
  repoRuntimeId: string
  branchName: string
  worktreePath: string | null
  tabs: WorkspacePaneTabEntry[]
}

export interface UpdateWorkspacePaneTabsInput {
  repoRoot: string
  repoRuntimeId: string
  branchName: string
  worktreePath: string | null
  operation: WorkspacePaneTabsUpdateOperation
}

export type WorkspacePaneTabsMutationOperation = 'commit' | 'update' | 'reorder'

export interface WorkspacePaneTabsMutationSuccess {
  ok: true
  /** Whether this client runtime accepted the canonical server result into its query projection. */
  projectionApplied: boolean
}

export interface WorkspacePaneTabsMutationFailure {
  ok: false
  operation: WorkspacePaneTabsMutationOperation
  repoRoot: string
  branchName: string
  worktreePath: string | null
  message: string
  error: unknown
  canceled?: boolean
}

export type WorkspacePaneTabsMutationResult = WorkspacePaneTabsMutationSuccess | WorkspacePaneTabsMutationFailure

interface WorkspacePaneTabsInteractionTarget {
  repoRoot: string
  branchName: string
  worktreePath: string | null
}

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
    isBlocked(input: {
      repoRoot: string
      branchName: string | null | undefined
      worktreePath: string | null
    }): boolean {
      const branchName = input.branchName
      if (!branchName) return false
      const key = workspacePaneTabsTargetIdentityKey({
        repoRoot: input.repoRoot,
        branchName,
        worktreePath: input.worktreePath,
      })
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
  goblinLog.warn(`workspace pane tabs ${input.operation} failed`, {
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
  return await workspacePaneTabsInteractionBlocker.run(input, true, () => commitWorkspacePaneTabsNow(input))
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

export function workspacePaneTabsInteractionBlockedForTarget(input: {
  repoRoot: string
  branchName: string | null | undefined
  worktreePath: string | null
}): boolean {
  return workspacePaneTabsInteractionBlocker.isBlocked(input)
}

function workspacePaneTabsUpdateBlocksInteraction(operation: WorkspacePaneTabsUpdateOperation): boolean {
  return operation.type !== 'open-static'
}

async function commitWorkspacePaneTabsNow(
  input: CommitWorkspacePaneTabsInput,
): Promise<WorkspacePaneTabsMutationResult> {
  try {
    const snapshot = await replaceWorkspacePaneTabsOnServer(input)
    const accepted = writeCanonicalWorkspacePaneTabsSnapshot(input.repoRoot, input.repoRuntimeId, snapshot)
    return { ok: true, projectionApplied: accepted }
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
    const snapshot = await updateWorkspacePaneTabsOnServer(input)
    const accepted = writeCanonicalWorkspacePaneTabsSnapshot(input.repoRoot, input.repoRuntimeId, snapshot)
    return { ok: true, projectionApplied: accepted }
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

export function writeCanonicalWorkspacePaneTabsSnapshot(
  repoRoot: string,
  repoRuntimeId: string,
  snapshot: WorkspacePaneTabsSnapshot,
  queryClient?: QueryClient,
): boolean {
  if (!workspacePaneTabsProjectionScopeAccepted({ repoRoot, repoRuntimeId })) return false
  return writeWorkspacePaneTabsSnapshotQueryData(repoRoot, repoRuntimeId, snapshot, queryClient)
}

export async function replaceWorkspacePaneTabsOnServer(
  input: CommitWorkspacePaneTabsInput,
): Promise<WorkspacePaneTabsSnapshot> {
  return await workspacePaneTabsClient.replace({
    repoRoot: input.repoRoot,
    repoRuntimeId: input.repoRuntimeId,
    branchName: input.branchName,
    worktreePath: input.worktreePath,
    tabs: input.tabs,
  })
}

export async function updateWorkspacePaneTabsOnServer(
  input: UpdateWorkspacePaneTabsInput,
): Promise<WorkspacePaneTabsSnapshot> {
  return await workspacePaneTabsClient.update({
    repoRoot: input.repoRoot,
    repoRuntimeId: input.repoRuntimeId,
    branchName: input.branchName,
    worktreePath: input.worktreePath,
    operation: input.operation,
  })
}

function workspacePaneTabsProjectionScopeAccepted(
  input: Pick<CommitWorkspacePaneTabsInput, 'repoRoot' | 'repoRuntimeId'>,
): boolean {
  return currentRepoRuntimeId(useReposStore.getState(), input.repoRoot) === input.repoRuntimeId
}
