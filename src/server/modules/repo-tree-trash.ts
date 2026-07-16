import path from 'node:path'
import { lstat } from 'node:fs/promises'
import { isRemoteRepoId } from '#/shared/remote-repo.ts'
import type { ExecResult, WorktreeInfo } from '#/shared/git-types.ts'
import { remoteRuntimeAwareGitRunner, resolveRemoteRepoTarget } from '#/server/modules/repo-source.ts'
import { getWorktrees } from '#/system/git/worktrees.ts'
import { trashRemoteFile } from '#/system/ssh/git.ts'
import { movePathToTrash } from '#/system/trash.ts'
import { resolveWorkspaceScopedPath } from '#/server/modules/workspace-path.ts'

export async function trashRepositoryFile(
  cwd: string,
  worktreePath: string,
  filePath: string,
  signal?: AbortSignal,
  options: { repoRuntimeId?: string } = {},
): Promise<ExecResult> {
  if (signal?.aborted) return { ok: false, message: 'cancelled' }
  if (!hasUsableWorktreePath(worktreePath)) return { ok: false, message: 'error.invalid-worktree-path' }
  const workspacePath = resolveWorkspaceScopedPath(cwd, worktreePath)
  const executionPath = workspacePath ?? worktreePath

  if (isRemoteRepoId(cwd)) {
    const target = await resolveRemoteRepoTarget(
      cwd,
      options.repoRuntimeId ? { repoRuntimeId: options.repoRuntimeId } : undefined,
    )
    const run = options.repoRuntimeId ? remoteRuntimeAwareGitRunner(cwd, options.repoRuntimeId, target) : undefined
    return await trashRemoteFile(target, executionPath, filePath, { signal, ...(run ? { run } : {}) })
  }

  if (!workspacePath) {
    const worktrees = await getWorktrees(cwd, { includeStatus: false, signal })
    if (!matchesKnownWorktree(worktrees, executionPath)) return { ok: false, message: 'error.invalid-worktree-path' }
  }

  const absolutePath = resolveWorktreeRelativePath(executionPath, filePath)
  if (!absolutePath) return { ok: false, message: 'error.invalid-path' }

  try {
    const stat = await lstat(absolutePath)
    if (stat.isDirectory()) return { ok: false, message: 'error.filetree-delete-directory-unsupported' }
  } catch (err) {
    const code = typeof err === 'object' && err && 'code' in err ? String((err as { code?: unknown }).code) : ''
    return { ok: false, message: code === 'ENOENT' ? 'error.file-not-found' : 'error.failed-trash-file' }
  }

  return await movePathToTrash(absolutePath, signal)
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

function resolveWorktreeRelativePath(worktreePath: string, filePath: string): string | null {
  if (!filePath || filePath.includes('\0')) return null
  const root = path.resolve(worktreePath)
  const absolutePath = path.resolve(root, ...filePath.split('/'))
  const relative = path.relative(root, absolutePath)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return null
  return absolutePath
}
