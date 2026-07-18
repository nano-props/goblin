import path from 'node:path'
import type { RepoFileViewerResult } from '#/shared/api-types.ts'
import type { WorktreeInfo } from '#/shared/git-types.ts'
import { isRemoteWorkspaceId } from '#/shared/remote-workspace.ts'
import { remoteRuntimeAwareGitRunner, resolveRemoteWorkspaceTarget } from '#/server/modules/repo-source.ts'
import { getWorktrees } from '#/system/git/worktrees.ts'
import { remoteCommandExists, remoteCommandExistsAtWorkspaceRoot, resolveRemoteWorktree } from '#/system/ssh/git.ts'
import { userShellCommandExists } from '#/system/user-shell.ts'
import { resolveWorkspaceScopedPath } from '#/server/modules/workspace-path.ts'
import { parseWorkspaceLocator } from '#/shared/workspace-locator.ts'

const BAT_VIEWERS = ['bat', 'batcat'] as const
type RepoFileViewer = Omit<RepoFileViewerResult, 'executionRoot'>

const POSIX_CAT_VIEWER: RepoFileViewer = { viewer: 'cat', shell: 'posix' }
const CMD_TYPE_VIEWER: RepoFileViewer = { viewer: 'type', shell: 'cmd' }

export async function getRepositoryFileViewer(
  cwd: string,
  worktreePath: string,
  signal?: AbortSignal,
  options: { workspaceRuntimeId?: string } = {},
): Promise<RepoFileViewerResult> {
  const fallbackViewer = localFallbackViewer()
  if (signal?.aborted) throw new Error('aborted')
  if (!hasUsableWorktreePath(worktreePath)) throw new Error('invalid worktree path')
  const workspacePath = resolveWorkspaceScopedPath(cwd, worktreePath)
  const executionPath = workspacePath ?? worktreePath

  if (isRemoteWorkspaceId(cwd)) {
    const target = await resolveRemoteWorkspaceTarget(
      cwd,
      options.workspaceRuntimeId ? { workspaceRuntimeId: options.workspaceRuntimeId } : undefined,
    )
    const run = options.workspaceRuntimeId
      ? remoteRuntimeAwareGitRunner(cwd, options.workspaceRuntimeId, target)
      : undefined
    const worktree = workspacePath
      ? null
      : await resolveRemoteWorktree(target, executionPath, { signal, ...(run ? { run } : {}) })
    for (const viewer of BAT_VIEWERS) {
      const exists = workspacePath
        ? await remoteCommandExistsAtWorkspaceRoot(target, executionPath, viewer, {
            signal,
            ...(run ? { run } : {}),
          })
        : await remoteCommandExists(target, worktree!.path, viewer, {
            signal,
            knownWorktrees: [worktree!],
            ...(run ? { run } : {}),
          })
      if (exists) return fileViewerResult({ viewer, shell: 'posix' }, executionPath)
    }
    return fileViewerResult(POSIX_CAT_VIEWER, executionPath)
  }

  if (!workspacePath) {
    const locator = parseWorkspaceLocator(cwd, process.platform === 'win32' ? 'win32' : 'posix')
    if (!locator || locator.transport !== 'file') throw new Error('error.workspace-locator-malformed')
    const worktrees = await getWorktrees(locator.path, { includeStatus: false, signal })
    if (!matchesKnownWorktree(worktrees, executionPath)) throw new Error('unknown worktree path')
  }

  for (const viewer of BAT_VIEWERS) {
    const exists = await userShellCommandExists(viewer, executionPath, signal)
    if (exists) return fileViewerResult({ viewer, shell: localShellDialect() }, executionPath)
  }
  return fileViewerResult(fallbackViewer, executionPath)
}

function localFallbackViewer(): RepoFileViewer {
  return process.platform === 'win32' ? CMD_TYPE_VIEWER : POSIX_CAT_VIEWER
}

function localShellDialect(): RepoFileViewer['shell'] {
  return process.platform === 'win32' ? 'cmd' : 'posix'
}

function fileViewerResult(viewer: RepoFileViewer, executionRoot: string): RepoFileViewerResult {
  return { ...viewer, executionRoot }
}

function hasUsableWorktreePath(worktreePath: string): boolean {
  return worktreePath.length > 0 && !worktreePath.includes('\0')
}

function matchesKnownWorktree(worktrees: ReadonlyArray<WorktreeInfo>, worktreePath: string): boolean {
  const resolved = path.resolve(worktreePath)
  for (const wt of worktrees) {
    if (wt.isBare) continue
    if (path.resolve(wt.path) === resolved) return true
  }
  return false
}
