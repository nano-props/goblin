import { lstat, opendir, stat } from 'node:fs/promises'
import path from 'node:path'
import { localWorkspaceNativePath } from '#/server/modules/workspace-path.ts'
import { resolveRemoteWorkspaceTarget } from '#/server/modules/remote-repo-execution.ts'
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
  using timer = setTimeout(() => timeoutController.abort(), DIRECTORY_OVERVIEW_TIMEOUT_MS)
  const signal = requestSignal ? AbortSignal.any([requestSignal, timeoutController.signal]) : timeoutController.signal
  try {
    return await operation(signal)
  } catch (error) {
    if (timeoutController.signal.aborted && !requestSignal?.aborted) {
      throw new Error('workspace directory overview timed out', { cause: error })
    }
    throw error
  }
}

export async function readLocalDirectoryOverview(
  root: string,
  signal?: AbortSignal,
): Promise<WorkspaceDirectoryOverview> {
  let topLevelFileCount = 0
  let topLevelDirectoryCount = 0
  signal?.throwIfAborted()
  const rootStat = await stat(root)
  if (!rootStat.isDirectory()) {
    throw new Error('workspace overview root is not a directory')
  }
  const lastModifiedAt = rootStat.mtime.toISOString()
  const handle = await opendir(root)
  try {
    for await (const entry of handle) {
      signal?.throwIfAborted()
      const entryPath = path.join(root, entry.name)
      let entryStat
      try {
        entryStat = await lstat(entryPath)
      } catch {
        signal?.throwIfAborted()
        continue
      }
      if (entryStat.isDirectory()) topLevelDirectoryCount += 1
      else if (entryStat.isFile()) topLevelFileCount += 1
    }
  } finally {
    await handle.close().catch(() => undefined)
  }
  return { topLevelFileCount, topLevelDirectoryCount, lastModifiedAt }
}

export function parseRemoteDirectoryOverview(output: string): WorkspaceDirectoryOverview {
  const record = output.endsWith('\n') ? output.slice(0, -1) : output
  const fields = record.split('\t')
  const topLevelFileCount = parseCanonicalOverviewInteger(fields[0])
  const topLevelDirectoryCount = parseCanonicalOverviewInteger(fields[1])
  const lastModifiedAtSeconds = parseCanonicalSignedInteger(fields[2])
  const lastModifiedAtDate = lastModifiedAtSeconds === undefined ? null : new Date(lastModifiedAtSeconds * 1_000)
  if (
    fields.length !== 3 ||
    topLevelFileCount === undefined ||
    topLevelDirectoryCount === undefined ||
    !lastModifiedAtDate ||
    Number.isNaN(lastModifiedAtDate.getTime())
  ) {
    throw new Error('invalid remote directory overview')
  }
  return { topLevelFileCount, topLevelDirectoryCount, lastModifiedAt: lastModifiedAtDate.toISOString() }
}

function parseCanonicalOverviewInteger(field: string | undefined): number | undefined {
  if (!field || !/^(?:0|[1-9][0-9]*)$/u.test(field)) return undefined
  const value = Number(field)
  return Number.isSafeInteger(value) ? value : undefined
}

function parseCanonicalSignedInteger(field: string | undefined): number | undefined {
  if (!field || !/^(?:0|-?[1-9][0-9]*)$/u.test(field)) return undefined
  const value = Number(field)
  return Number.isSafeInteger(value) ? value : undefined
}
