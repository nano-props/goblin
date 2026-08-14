import { onScopeDispose } from 'vue'
import { appQueryClient } from '#/web/app/query-client.ts'
import { startWorkspaceFilesystemQueryInvalidationSync } from '#/web/workspaces/filesystem/query.ts'

export function useWorkspaceFilesystemInvalidationSync(): void {
  onScopeDispose(startWorkspaceFilesystemQueryInvalidationSync(appQueryClient))
}
