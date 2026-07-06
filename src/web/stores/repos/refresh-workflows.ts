import { appendRepoEvent, errorEvent } from '#/web/stores/repos/repo-state-factory.ts'
import { isRepoUnavailable, updateIfFresh } from '#/web/stores/repos/repo-guards.ts'
import { persistRepoSnapshotCacheEntry } from '#/web/stores/repos/persistence.ts'
import { refreshPullRequestsLog, terminalLog } from '#/web/logger.ts'
import { terminalClient } from '#/web/terminal.ts'
import type { ReposGet, ReposSet } from '#/web/stores/repos/types.ts'

function repoFresh(get: ReposGet, id: string, repoInstanceId: string): boolean {
  const repo = get().repos[id]
  return !!repo && repo.instanceId === repoInstanceId
}

async function refreshPullRequestSummaryAfterSnapshot(
  get: ReposGet,
  options: { id: string; repoInstanceId: string; branchNames: string[]; isSnapshotCurrent: () => boolean },
): Promise<void> {
  if (!options.isSnapshotCurrent() || !repoFresh(get, options.id, options.repoInstanceId)) return
  await get().refreshPullRequests(options.id, options.branchNames, {
    repoInstanceId: options.repoInstanceId,
    mode: 'summary',
  })
}

export async function runSnapshotSuccessWorkflow(
  set: ReposSet,
  get: ReposGet,
  options: {
    id: string
    repoInstanceId: string
    branchNames: string[]
    worktreePaths: string[]
    isSnapshotCurrent: () => boolean
    skipLogBackfill?: boolean
  },
): Promise<void> {
  if (!options.isSnapshotCurrent()) return
  persistRepoSnapshotCacheEntry(set, get().repos[options.id], options.repoInstanceId)
  void terminalClient.pruneTerminals(options.id, options.repoInstanceId).catch((err) => {
    terminalLog.warn('failed to prune repo sessions', { err })
  })
  void (async () => {
    try {
      if (options.isSnapshotCurrent()) await refreshPullRequestSummaryAfterSnapshot(get, options)
    } catch (err) {
      refreshPullRequestsLog.warn('failed', { err })
      const message = err instanceof Error ? err.message : String(err)
      updateIfFresh(set, options.id, options.repoInstanceId, (r) => {
        r.events = appendRepoEvent(r.events, errorEvent(message))
      })
    }
  })()
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
