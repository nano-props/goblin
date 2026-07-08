import { isRepoUnavailable } from '#/web/stores/repos/repo-guards.ts'
import { persistRepoSnapshotCacheEntry } from '#/web/stores/repos/persistence.ts'
import { terminalLog } from '#/web/logger.ts'
import { terminalClient } from '#/web/terminal.ts'
import type { ReposGet, ReposSet } from '#/web/stores/repos/types.ts'

export async function runSnapshotSuccessWorkflow(
  set: ReposSet,
  get: ReposGet,
  options: {
    id: string
    repoRuntimeId: string
    isSnapshotCurrent: () => boolean
  },
): Promise<void> {
  if (!options.isSnapshotCurrent()) return
  persistRepoSnapshotCacheEntry(set, get().repos[options.id], options.repoRuntimeId)
  void terminalClient.pruneTerminals(options.id, options.repoRuntimeId).catch((err) => {
    terminalLog.warn('failed to prune repo sessions', { err })
  })
}

export async function runCoreDataRefreshWorkflow(
  get: ReposGet,
  options: { id: string; repoRuntimeId: string },
): Promise<void> {
  await get().refreshRuntimeProjection(options.id, {
    repoRuntimeId: options.repoRuntimeId,
    scope: 'repo-read-model',
  })
  const after = get().repos[options.id]
  if (!after || after.repoRuntimeId !== options.repoRuntimeId) return
  if (isRepoUnavailable(after)) return
}
