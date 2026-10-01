import type { RepoReadInvalidationEvent } from '#/shared/repo-read-invalidation.ts'
import type { WorkspaceRuntimeInvalidationEvent } from '#/shared/workspace-runtime-invalidation.ts'
import type { WorkspaceFilesystemInvalidationEvent } from '#/shared/workspace-filesystem-invalidation.ts'
import type { SettingsInvalidationEvent, SettingsInvalidationScope } from '#/shared/server-invalidation.ts'

import { publishNotification } from '#/server/realtime/notification-broker.ts'

export function publishRepoReadInvalidation(event: Omit<RepoReadInvalidationEvent, 'type'>): void {
  publishNotification({ type: 'repo-read-invalidated', ...event } satisfies RepoReadInvalidationEvent)
}

export function publishUserRepoReadInvalidation(userId: string, event: Omit<RepoReadInvalidationEvent, 'type'>): void {
  publishNotification({ type: 'repo-read-invalidated', ...event } satisfies RepoReadInvalidationEvent, userId)
}

export function publishUserWorkspaceRuntimeInvalidation(
  userId: string,
  event: Omit<WorkspaceRuntimeInvalidationEvent, 'type'>,
): void {
  publishNotification(
    { type: 'workspace-runtime-invalidated', ...event } satisfies WorkspaceRuntimeInvalidationEvent,
    userId,
  )
}

export function publishUserWorkspaceFilesystemInvalidation(
  userId: string,
  event: Omit<WorkspaceFilesystemInvalidationEvent, 'type'>,
): void {
  publishNotification(
    { type: 'workspace-filesystem-invalidated', ...event } satisfies WorkspaceFilesystemInvalidationEvent,
    userId,
  )
}

export function publishSettingsInvalidation(scopes: SettingsInvalidationScope[]): void {
  if (scopes.length === 0) return
  publishNotification({ type: 'settings-invalidated', scopes } satisfies SettingsInvalidationEvent)
}
