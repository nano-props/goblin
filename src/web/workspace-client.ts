import type {
  WorkspaceRuntimeMembershipReconcileResult,
  WorkspaceRuntimeOpenResult,
  WorkspaceRuntimesSnapshot,
} from '#/shared/api-types.ts'
import type { WorkspaceRefreshResult } from '#/shared/workspace-runtime.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { WorkspaceDirectoryOverview } from '#/shared/workspace-overview.ts'
import { readClientPageId } from '#/web/client-page-id.ts'
import { postServerJson } from '#/web/lib/server-fetch.ts'
import { decodeWith } from '#/shared/http-response-schema.ts'
import {
  StringArrayResponseSchema,
  WorkspaceDirectoryOverviewResponseSchema,
  WorkspaceRefreshResponseSchema,
  WorkspaceRuntimeCloseResponseSchema,
  WorkspaceRuntimeOpenIdResponseSchema,
  WorkspaceRuntimeOpenResponseSchema,
  WorkspaceRuntimesResponseSchema,
} from '#/shared/workspace-http-response-schema.ts'

export async function refreshWorkspace(
  workspaceId: WorkspaceId,
  workspaceRuntimeId: string,
  signal?: AbortSignal,
): Promise<WorkspaceRefreshResult> {
  return await postServerJson('/api/workspace/refresh', { workspaceId, workspaceRuntimeId }, decodeWith(WorkspaceRefreshResponseSchema), { signal })
}

export async function openWorkspaceRuntime(workspaceId: WorkspaceId): Promise<string> {
  const result = await postServerJson(
    '/api/workspace/runtime-open',
    { workspaceId, clientId: readClientPageId() },
    decodeWith(WorkspaceRuntimeOpenIdResponseSchema),
  )
  return result.workspaceRuntimeId
}

export async function openWorkspaceRuntimeForInput(workspaceInput: string): Promise<WorkspaceRuntimeOpenResult> {
  return await postServerJson(
    '/api/workspace/runtime-open',
    { workspaceInput, clientId: readClientPageId() },
    decodeWith(WorkspaceRuntimeOpenResponseSchema),
  )
}

export async function reconcileWorkspaceRuntimeMemberships(
  workspaceIds: WorkspaceId[],
): Promise<WorkspaceRuntimeMembershipReconcileResult> {
  return await postServerJson('/api/workspace/runtime-reconcile', {
    clientId: readClientPageId(),
    workspaceIds,
  }, decodeWith(WorkspaceRuntimesResponseSchema))
}

export async function closeWorkspaceRuntime(workspaceId: WorkspaceId, workspaceRuntimeId: string): Promise<boolean> {
  const result = await postServerJson('/api/workspace/runtime-close', {
    workspaceId,
    workspaceRuntimeId,
    clientId: readClientPageId(),
  }, decodeWith(WorkspaceRuntimeCloseResponseSchema))
  return result.released
}

export async function listWorkspaceRuntimes(signal?: AbortSignal): Promise<WorkspaceRuntimesSnapshot> {
  return await postServerJson('/api/workspace/runtime-list', {}, decodeWith(WorkspaceRuntimesResponseSchema), { signal })
}

export async function getWorkspaceDirectoryOverview(
  workspaceId: WorkspaceId,
  workspaceRuntimeId: string,
  signal?: AbortSignal,
): Promise<WorkspaceDirectoryOverview> {
  return await postServerJson('/api/workspace/directory-overview', { workspaceId, workspaceRuntimeId }, decodeWith(WorkspaceDirectoryOverviewResponseSchema), { signal })
}

export async function getLocalDirectoryPathSuggestions(prefix: string, signal?: AbortSignal): Promise<string[]> {
  return await postServerJson('/api/workspace/path-suggestions', { prefix }, decodeWith(StringArrayResponseSchema), { signal })
}
