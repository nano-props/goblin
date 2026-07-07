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
    repoInstanceId: string
    isSnapshotCurrent: () => boolean
  },
): Promise<void> {
  if (!options.isSnapshotCurrent()) return
  persistRepoSnapshotCacheEntry(set, get().repos[options.id], options.repoInstanceId)
  void terminalClient.pruneTerminals(options.id, options.repoInstanceId).catch((err) => {
    terminalLog.warn('failed to prune repo sessions', { err })
  })
}

export async function runCoreDataRefreshWorkflow(
  get: ReposGet,
  options: { id: string; repoInstanceId: string },
): Promise<void> {
  await get().refreshSnapshotAndStatus(options.id, { skipLogBackfill: true, repoInstanceId: options.repoInstanceId })
  const after = get().repos[options.id]
  if (!after || after.instanceId !== options.repoInstanceId) return
  if (isRepoUnavailable(after)) return
}
