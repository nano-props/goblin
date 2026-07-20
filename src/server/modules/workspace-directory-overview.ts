import { lstat, opendir } from 'node:fs/promises'
import path from 'node:path'
import { localWorkspaceNativePath } from '#/server/modules/workspace-path.ts'
import { resolveRemoteWorkspaceTarget } from '#/server/modules/repo-source.ts'
import { runRemoteCommand } from '#/system/ssh/commands.ts'
import type { WorkspaceDirectoryOverview } from '#/shared/workspace-overview.ts'
import { remoteWorkspaceRuntimeFailureFromCommandResult } from '#/server/modules/remote-workspace-runtime-failure.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

const DIRECTORY_OVERVIEW_TIMEOUT_MS = 30_000

export async function readWorkspaceDirectoryOverview(
  workspaceId: WorkspaceId,
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
  let totalSizeComplete = true
  const pending = [root]

  while (pending.length > 0) {
    signal?.throwIfAborted()
    const directory = pending.pop()
    if (!directory) break
    let directoryStat
    try {
      directoryStat = await lstat(directory)
    } catch (error) {
      signal?.throwIfAborted()
      if (directory === root) throw error
      totalSizeComplete = false
      continue
    }
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) continue
    let handle
    try {
      handle = await opendir(directory)
    } catch (error) {
      signal?.throwIfAborted()
      if (directory === root) throw error
      totalSizeComplete = false
      continue
    }
    try {
      for await (const entry of handle) {
        signal?.throwIfAborted()
        const entryPath = path.join(directory, entry.name)
        let entryStat
        try {
          entryStat = await lstat(entryPath)
        } catch {
          signal?.throwIfAborted()
          totalSizeComplete = false
          continue
        }
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
  return {
    topLevelFileCount,
    topLevelDirectoryCount,
    totalSizeBytes: totalSizeComplete ? totalSizeBytes : null,
  }
}

export function parseRemoteDirectoryOverview(output: string): WorkspaceDirectoryOverview {
  const record = output.endsWith('\n') ? output.slice(0, -1) : output
  const fields = record.split('\t')
  const topLevelFileCount = parseCanonicalOverviewInteger(fields[0])
  const topLevelDirectoryCount = parseCanonicalOverviewInteger(fields[1])
  const totalSizeBytes = fields[2] === '-' ? null : parseCanonicalOverviewInteger(fields[2])
  if (
    fields.length !== 3 ||
    topLevelFileCount === undefined ||
    topLevelDirectoryCount === undefined ||
    totalSizeBytes === undefined
  ) {
    throw new Error('invalid remote directory overview')
  }
  return { topLevelFileCount, topLevelDirectoryCount, totalSizeBytes }
}

function parseCanonicalOverviewInteger(field: string | undefined): number | undefined {
  if (!field || !/^(?:0|[1-9][0-9]*)$/u.test(field)) return undefined
  const value = Number(field)
  return Number.isSafeInteger(value) ? value : undefined
}
