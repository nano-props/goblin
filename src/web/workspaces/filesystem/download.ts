import type { WorkspacePaneFilesystemExecutionTarget } from '#/shared/workspace-runtime.ts'
import { requireClientServerConfig } from '#/web/lib/server-config.ts'
import { resolveApiBaseUrl } from '#/web/lib/websocket-url.ts'

export function downloadWorkspaceFile(target: WorkspacePaneFilesystemExecutionTarget, path: string): void {
  const server = requireClientServerConfig()
  const url = new URL('/api/workspace/download-file', resolveApiBaseUrl(server.url))
  url.searchParams.set('kind', target.kind)
  url.searchParams.set('workspaceId', target.workspaceId)
  url.searchParams.set('workspaceRuntimeId', target.workspaceRuntimeId)
  if (target.kind === 'git-worktree') url.searchParams.set('root', target.root)
  url.searchParams.set('path', path)

  window.open(url.toString(), '_blank')
}
