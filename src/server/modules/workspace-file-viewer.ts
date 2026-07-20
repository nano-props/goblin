import type { WorkspaceFileViewerResult } from '#/shared/api-types.ts'
import { remoteCommandExists, remoteCommandExistsAtWorkspaceRoot } from '#/system/ssh/git.ts'
import { userShellCommandExists } from '#/system/user-shell.ts'
import type { WorkspacePaneFilesystemExecutionTarget } from '#/shared/workspace-runtime.ts'
import { resolveWorkspaceFilesystemExecution } from '#/server/modules/workspace-filesystem-execution.ts'

const BAT_VIEWERS = ['bat', 'batcat'] as const
type WorkspaceFileViewer = Omit<WorkspaceFileViewerResult, 'executionRoot'>

const POSIX_CAT_VIEWER: WorkspaceFileViewer = { viewer: 'cat', shell: 'posix' }
const CMD_TYPE_VIEWER: WorkspaceFileViewer = { viewer: 'type', shell: 'cmd' }

export async function readWorkspaceFileViewer(
  target: WorkspacePaneFilesystemExecutionTarget,
  signal?: AbortSignal,
): Promise<WorkspaceFileViewerResult> {
  const fallbackViewer = localFallbackViewer()
  if (signal?.aborted) throw new Error('aborted')
  const resolved = await resolveWorkspaceFilesystemExecution(target, { signal })

  if (resolved.transport === 'remote') {
    for (const viewer of BAT_VIEWERS) {
      const exists =
        target.kind === 'workspace-root'
          ? await remoteCommandExistsAtWorkspaceRoot(resolved.remoteTarget, resolved.executionPath, viewer, {
              signal,
              run: resolved.run,
            })
          : await remoteCommandExists(resolved.remoteTarget, resolved.worktree!.path, viewer, {
              signal,
              knownWorktrees: [resolved.worktree!],
              run: resolved.run,
            })
      if (exists) return fileViewerResult({ viewer, shell: 'posix' }, resolved.executionPath)
    }
    return fileViewerResult(POSIX_CAT_VIEWER, resolved.executionPath)
  }

  for (const viewer of BAT_VIEWERS) {
    const exists = await userShellCommandExists(viewer, resolved.executionPath, signal)
    if (exists) return fileViewerResult({ viewer, shell: localShellDialect() }, resolved.executionPath)
  }
  return fileViewerResult(fallbackViewer, resolved.executionPath)
}

function localFallbackViewer(): WorkspaceFileViewer {
  return process.platform === 'win32' ? CMD_TYPE_VIEWER : POSIX_CAT_VIEWER
}

function localShellDialect(): WorkspaceFileViewer['shell'] {
  return process.platform === 'win32' ? 'cmd' : 'posix'
}

function fileViewerResult(viewer: WorkspaceFileViewer, executionRoot: string): WorkspaceFileViewerResult {
  return { ...viewer, executionRoot }
}
