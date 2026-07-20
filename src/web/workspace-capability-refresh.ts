import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { WorkspaceRefreshResult } from '#/shared/workspace-runtime.ts'
import { refreshWorkspace } from '#/web/workspace-client.ts'

export type WorkspaceCapabilityRefreshOutcome =
  { kind: 'completed'; result: WorkspaceRefreshResult } | { kind: 'cancelled' } | { kind: 'failed'; message: string }

interface WorkspaceCapabilityRefreshAdmission {
  controller: AbortController
  promise: Promise<WorkspaceCapabilityRefreshOutcome>
}

const admissions = new Map<string, WorkspaceCapabilityRefreshAdmission>()

export function requestWorkspaceCapabilityRefresh(
  workspaceId: WorkspaceId,
  workspaceRuntimeId: string,
): Promise<WorkspaceCapabilityRefreshOutcome> {
  const key = admissionKey(workspaceId, workspaceRuntimeId)
  const existing = admissions.get(key)
  if (existing) return existing.promise

  const controller = new AbortController()
  const admission: WorkspaceCapabilityRefreshAdmission = {
    controller,
    promise: runWorkspaceCapabilityRefresh(workspaceId, workspaceRuntimeId, controller.signal),
  }
  admissions.set(key, admission)
  void admission.promise.finally(() => {
    if (admissions.get(key) === admission) admissions.delete(key)
  })
  return admission.promise
}

export function cancelWorkspaceCapabilityRefreshes(workspaceId: WorkspaceId, workspaceRuntimeId?: string): void {
  const prefix = `${workspaceId}\0`
  for (const [key, admission] of admissions) {
    if (
      !key.startsWith(prefix) ||
      (workspaceRuntimeId !== undefined && key !== admissionKey(workspaceId, workspaceRuntimeId))
    ) {
      continue
    }
    admission.controller.abort()
    admissions.delete(key)
  }
}

async function runWorkspaceCapabilityRefresh(
  workspaceId: WorkspaceId,
  workspaceRuntimeId: string,
  signal: AbortSignal,
): Promise<WorkspaceCapabilityRefreshOutcome> {
  try {
    return { kind: 'completed', result: await refreshWorkspace(workspaceId, workspaceRuntimeId, signal) }
  } catch (error) {
    if (signal.aborted || isAbortError(error)) return { kind: 'cancelled' }
    return { kind: 'failed', message: error instanceof Error ? error.message : String(error) }
  }
}

function admissionKey(workspaceId: WorkspaceId, workspaceRuntimeId: string): string {
  return `${workspaceId}\0${workspaceRuntimeId}`
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
}
