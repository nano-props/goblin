import { opendir, stat } from 'node:fs/promises'
import path from 'node:path'
import { localWorkspaceNativePath } from '#/server/modules/workspace-path.ts'
import { resolveRemoteRepoTarget } from '#/server/modules/repo-source.ts'
import { runRemoteCommand } from '#/system/ssh/commands.ts'
import type { WorkspaceDirectoryOverview } from '#/shared/workspace-overview.ts'

export async function readWorkspaceDirectoryOverview(
  workspaceId: string,
  options: { repoRuntimeId: string; signal?: AbortSignal },
): Promise<WorkspaceDirectoryOverview> {
  const localPath = localWorkspaceNativePath(workspaceId)
  if (localPath) return await readLocalDirectoryOverview(localPath, options.signal)

  const target = await resolveRemoteRepoTarget(workspaceId, { repoRuntimeId: options.repoRuntimeId })
  const result = await runRemoteCommand(
    target,
    { type: 'directoryOverview', path: target.remotePath },
    { signal: options.signal },
  )
  if (!result.ok) throw new Error(result.message)
  return parseRemoteDirectoryOverview(result.stdout)
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
    const handle = await opendir(directory)
    try {
      for await (const entry of handle) {
        signal?.throwIfAborted()
        if (directory === root) {
          if (entry.isDirectory()) topLevelDirectoryCount += 1
          else if (entry.isFile()) topLevelFileCount += 1
        }
        if (entry.isDirectory()) pending.push(path.join(directory, entry.name))
        else if (entry.isFile()) totalSizeBytes += (await stat(path.join(directory, entry.name))).size
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
