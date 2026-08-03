import path from 'node:path'
import { lstat } from 'node:fs/promises'
import type { ExecResult } from '#/shared/git-types.ts'
import { trashRemoteFile } from '#/system/ssh/git.ts'
import { movePathToTrash } from '#/system/trash.ts'
import type { WorkspacePaneFilesystemExecutionTarget } from '#/shared/workspace-runtime.ts'
import { resolveWorkspaceFilesystemExecution } from '#/server/modules/workspace-filesystem-execution.ts'
import type { TrashCommandOutcome } from '#/system/trash-command-outcome.ts'

export async function trashWorkspaceFile(
  target: WorkspacePaneFilesystemExecutionTarget,
  filePath: string,
  signal?: AbortSignal,
): Promise<TrashCommandOutcome> {
  if (signal?.aborted) return trashNotStarted({ ok: false, message: 'cancelled' })
  const resolved = await resolveWorkspaceFilesystemExecution(target, { signal })

  if (resolved.transport === 'remote') {
    return trashOutcomeForUser(
      await trashRemoteFile(resolved.remoteTarget, resolved.executionPath, filePath, {
        signal,
        run: resolved.run,
      }),
    )
  }

  const absolutePath = resolveWorktreeRelativePath(resolved.executionPath, filePath)
  if (!absolutePath) return trashNotStarted({ ok: false, message: 'error.invalid-path' })

  try {
    const stat = await lstat(absolutePath)
    if (stat.isDirectory()) {
      return trashNotStarted({ ok: false, message: 'error.filetree-delete-directory-unsupported' })
    }
  } catch (err) {
    const code = typeof err === 'object' && err && 'code' in err ? String((err as { code?: unknown }).code) : ''
    return trashNotStarted({
      ok: false,
      message: code === 'ENOENT' ? 'error.file-not-found' : 'error.failed-trash-file',
    })
  }

  return trashOutcomeForUser(await movePathToTrash(absolutePath, signal))
}

function trashNotStarted(result: ExecResult): TrashCommandOutcome {
  return { result, execution: { status: 'not-started' } }
}

function trashOutcomeForUser(outcome: TrashCommandOutcome): TrashCommandOutcome {
  switch (outcome.execution.status) {
    case 'cancelled':
      return { ...outcome, result: { ...outcome.result, message: 'error.trash-cancelled-check-state' } }
    case 'timed-out':
      return { ...outcome, result: { ...outcome.result, message: 'error.trash-timeout-check-state' } }
    case 'not-started':
    case 'succeeded':
    case 'failed':
      return outcome
  }
  const exhaustive: never = outcome.execution.status
  return exhaustive
}

function resolveWorktreeRelativePath(worktreePath: string, filePath: string): string | null {
  if (!filePath || filePath.includes('\0')) return null
  const root = path.resolve(worktreePath)
  const absolutePath = path.resolve(root, ...filePath.split('/'))
  const relative = path.relative(root, absolutePath)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return null
  return absolutePath
}
