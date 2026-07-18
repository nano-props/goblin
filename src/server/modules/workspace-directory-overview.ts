import { lstat, opendir } from 'node:fs/promises'
import path from 'node:path'
import { localWorkspaceNativePath } from '#/server/modules/workspace-path.ts'
import { resolveRemoteWorkspaceTarget } from '#/server/modules/repo-source.ts'
import { runRemoteCommand } from '#/system/ssh/commands.ts'
import type { WorkspaceDirectoryOverview } from '#/shared/workspace-overview.ts'
import { remoteWorkspaceRuntimeFailureFromCommandResult } from '#/server/modules/remote-workspace-runtime-failure.ts'

const DIRECTORY_OVERVIEW_TIMEOUT_MS = 30_000

export async function readWorkspaceDirectoryOverview(
  workspaceId: string,
  options: { workspaceRuntimeId: string; signal?: AbortSignal },
): Promise<WorkspaceDirectoryOverview> {
  const localPath = localWorkspaceNativePath(workspaceId)
  if (localPath) {
    return await runWithDirectoryOverviewTimeout(options.signal, (signal) =>
      readLocalDirectoryOverview(localPath, signal),
    )
  }

  const target = await resolveRemoteWorkspaceTarget(workspaceId, { workspaceRuntimeId: options.workspaceRuntimeId })
  const result = await runRemoteCommand(
    target,
    { type: 'directoryOverview', path: target.remotePath },
    { signal: options.signal, timeoutMs: DIRECTORY_OVERVIEW_TIMEOUT_MS },
  )
  const runtimeFailure = remoteWorkspaceRuntimeFailureFromCommandResult({
    workspaceId: workspaceId,
    workspaceRuntimeId: options.workspaceRuntimeId,
    target,
    result,
  })
  if (runtimeFailure) throw runtimeFailure
  if (!result.ok && options.signal?.aborted) options.signal.throwIfAborted()
  if (!result.ok) throw new Error(result.message)
  return parseRemoteDirectoryOverview(result.stdout)
}

async function runWithDirectoryOverviewTimeout<T>(
  requestSignal: AbortSignal | undefined,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const timeoutController = new AbortController()
  const timer = setTimeout(() => timeoutController.abort(), DIRECTORY_OVERVIEW_TIMEOUT_MS)
  const signal = requestSignal ? AbortSignal.any([requestSignal, timeoutController.signal]) : timeoutController.signal
  try {
    return await operation(signal)
  } catch (error) {
    if (timeoutController.signal.aborted && !requestSignal?.aborted) {
      throw new Error('workspace directory overview timed out', { cause: error })
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export async function readLocalDirectoryOverview(
  root: string,
  signal?: AbortSignal,
): Promise<WorkspaceDirectoryOverview> {
  let topLevelFileCount = 0
  let topLevelDirectoryCount = 0
  let totalSizeBytes = 0
  const pending = [root]

  while (pending.length > 0) {
    signal?.throwIfAborted()
    const directory = pending.pop()
    if (!directory) break
    const directoryStat = await lstat(directory)
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) continue
    const handle = await opendir(directory)
    try {
      for await (const entry of handle) {
        signal?.throwIfAborted()
        const entryPath = path.join(directory, entry.name)
        const entryStat = await lstat(entryPath)
        if (directory === root) {
          if (entryStat.isDirectory()) topLevelDirectoryCount += 1
          else if (entryStat.isFile()) topLevelFileCount += 1
        }
        if (entryStat.isDirectory()) pending.push(entryPath)
        else if (entryStat.isFile()) totalSizeBytes += entryStat.size
      }
    } finally {
      await handle.close().catch(() => undefined)
    }
  }
  return { topLevelFileCount, topLevelDirectoryCount, totalSizeBytes }
}

export function parseRemoteDirectoryOverview(output: string): WorkspaceDirectoryOverview {
  const fields = output.trim().split('\t').map(Number)
  if (fields.length !== 3 || fields.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error('invalid remote directory overview')
  }
  return { topLevelFileCount: fields[0]!, topLevelDirectoryCount: fields[1]!, totalSizeBytes: fields[2]! }
}
