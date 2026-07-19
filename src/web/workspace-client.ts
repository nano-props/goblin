import type {
  WorkspaceRuntimeMembershipReconcileResult,
  WorkspaceRuntimeOpenResult,
  WorkspaceRuntimesSnapshot,
} from '#/shared/api-types.ts'
import type { WorkspaceRefreshResult } from '#/shared/workspace-runtime.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { readOrCreateWebTerminalClientId } from '#/web/client-terminal-id.ts'
import { postServerJson } from '#/web/lib/server-fetch.ts'

export async function refreshWorkspace(
  workspaceId: WorkspaceId,
  workspaceRuntimeId: string,
  signal?: AbortSignal,
): Promise<WorkspaceRefreshResult> {
  return await postServerJson('/api/workspace/refresh', { workspaceId, workspaceRuntimeId }, { signal })
}

export async function openWorkspaceRuntime(workspaceId: WorkspaceId): Promise<string> {
  const result = await postServerJson<{ workspaceId: WorkspaceId; clientId: string }, { workspaceRuntimeId: string }>(
    '/api/workspace/runtime-open',
    { workspaceId, clientId: readOrCreateWebTerminalClientId() },
  )
  return result.workspaceRuntimeId
}

export async function openWorkspaceRuntimeForInput(workspaceInput: string): Promise<WorkspaceRuntimeOpenResult> {
  return await postServerJson<{ workspaceInput: string; clientId: string }, WorkspaceRuntimeOpenResult>(
    '/api/workspace/runtime-open',
    { workspaceInput, clientId: readOrCreateWebTerminalClientId() },
  )
}

export async function reconcileWorkspaceRuntimeMemberships(
  workspaceIds: WorkspaceId[],
): Promise<WorkspaceRuntimeMembershipReconcileResult> {
  return await postServerJson('/api/workspace/runtime-reconcile', {
    clientId: readOrCreateWebTerminalClientId(),
    workspaceIds,
  })
}

export async function closeWorkspaceRuntime(workspaceId: WorkspaceId, workspaceRuntimeId: string): Promise<boolean> {
  const result = await postServerJson<
    { workspaceId: WorkspaceId; workspaceRuntimeId: string; clientId: string },
    { ok: boolean; released: boolean; runtimeClosed: boolean }
  >('/api/workspace/runtime-close', {
    workspaceId,
    workspaceRuntimeId,
    clientId: readOrCreateWebTerminalClientId(),
  })
  return result.released
}

export async function listWorkspaceRuntimes(signal?: AbortSignal): Promise<WorkspaceRuntimesSnapshot> {
  return await postServerJson<{}, WorkspaceRuntimesSnapshot>('/api/workspace/runtime-list', {}, { signal })
}
