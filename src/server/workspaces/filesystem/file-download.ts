import type { WorkspacePaneFilesystemExecutionTarget } from '#/shared/workspace-runtime.ts'
import { resolveWorkspaceFilesystemExecution } from '#/server/workspaces/filesystem/execution.ts'
import { openLocalWorkspaceFileDownload } from '#/server/workspaces/filesystem/file-download-local.ts'
import { openRemoteWorkspaceFileDownload } from '#/server/workspaces/filesystem/file-download-remote.ts'

export interface WorkspaceFileDownload {
  filename: string
  stream: ReadableStream<Uint8Array>
}

export async function openWorkspaceFileDownload(
  target: WorkspacePaneFilesystemExecutionTarget,
  filePath: string,
  signal?: AbortSignal,
): Promise<WorkspaceFileDownload> {
  const resolved = await resolveWorkspaceFilesystemExecution(target, { signal })
  if (resolved.transport === 'local') return await openLocalWorkspaceFileDownload(resolved, filePath)
  return await openRemoteWorkspaceFileDownload(target, resolved, filePath, signal)
}
