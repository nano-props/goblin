import { onWorkspaceRuntimeClosed } from '#/server/modules/workspace-runtimes.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

const lastFetchAtByTarget = new Map<string, number>()
let runtimeCloseSubscription: (() => void) | null = null

function targetKey(workspaceId: WorkspaceId, workspaceRuntimeId: string): string {
  return `${workspaceId}\0${workspaceRuntimeId}`
}

function ensureRuntimeCloseSubscription(): void {
  runtimeCloseSubscription ??= onWorkspaceRuntimeClosed((event) => {
    lastFetchAtByTarget.delete(targetKey(event.workspaceId, event.workspaceRuntimeId))
  })
}

export function recordRepoFetchSuccess(workspaceId: WorkspaceId, workspaceRuntimeId: string | undefined): void {
  if (!workspaceRuntimeId) return
  ensureRuntimeCloseSubscription()
  lastFetchAtByTarget.set(targetKey(workspaceId, workspaceRuntimeId), Date.now())
}

export function getRepoLastFetchAt(workspaceId: WorkspaceId, workspaceRuntimeId: string | undefined): number | null {
  if (!workspaceRuntimeId) return null
  ensureRuntimeCloseSubscription()
  return lastFetchAtByTarget.get(targetKey(workspaceId, workspaceRuntimeId)) ?? null
}

export function resetRepoSyncStateForTests(): void {
  lastFetchAtByTarget.clear()
  runtimeCloseSubscription?.()
  runtimeCloseSubscription = null
}
