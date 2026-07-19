import { useEffect } from 'react'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { startWorkspaceFilesystemQueryInvalidationSync } from '#/web/workspace-filesystem-query.ts'

export function useWorkspaceFilesystemInvalidationSync(): void {
  useEffect(() => startWorkspaceFilesystemQueryInvalidationSync(primaryWindowQueryClient), [])
}
