import { appendRepoEvent, errorEvent, updateIfFresh } from '#/web/stores/repos/helpers.ts'
import { persistRepoCache } from '#/web/stores/repos/persistence.ts'
import { terminalBridge } from '#/web/terminal.ts'
import type { ReposGet, ReposSet } from '#/web/stores/repos/types.ts'

function repoFresh(get: ReposGet, id: string, token: number): boolean {
  const repo = get().repos[id]
  return !!repo && repo.instanceToken === token
}

function pullRequestRefreshFailed(get: ReposGet, id: string, token: number): boolean {
  const repo = get().repos[id]
  return !!repo && repo.instanceToken === token && repo.resources.pullRequests.error !== null
}

async function refreshVisibleDetailPullRequest(get: ReposGet, id: string, token: number): Promise<void> {
  const repo = get().repos[id]
  if (!repo || repo.instanceToken !== token || repo.ui.detailTab !== 'status' || !repo.ui.selectedBranch) return
  await get().refreshPullRequests(id, [repo.ui.selectedBranch], { token, mode: 'full' })
}

async function refreshPullRequestSummaryAfterSnapshot(
  get: ReposGet,
  options: { id: string; token: number; branchNames: string[]; isSnapshotCurrent: () => boolean },
): Promise<void> {
  if (!options.isSnapshotCurrent() || !repoFresh(get, options.id, options.token)) return
  await get().refreshPullRequests(options.id, options.branchNames, {
    token: options.token,
    mode: 'summary',
    clearMissing: true,
  })
}

export function runSnapshotSuccessWorkflow(
  set: ReposSet,
  get: ReposGet,
  options: {
    id: string
    token: number
    branchNames: string[]
    worktreePaths: string[]
    isSnapshotCurrent: () => boolean
    skipLogBackfill?: boolean
  },
): void {
  if (!options.isSnapshotCurrent()) return
  persistRepoCache(set, get().repos[options.id], options.token)
  void terminalBridge.pruneTerminals(options.id).catch((err) => {
    console.warn('[terminal] failed to prune repo sessions', err)
  })
  void (async () => {
    try {
      if (options.isSnapshotCurrent()) await refreshPullRequestSummaryAfterSnapshot(get, options)
      if (pullRequestRefreshFailed(get, options.id, options.token)) return
      if (options.isSnapshotCurrent()) await runSnapshotVisibleDetailBackfill(get, options)
    } catch (err) {
      console.warn('[refreshPullRequests] failed', err)
      const message = err instanceof Error ? err.message : String(err)
      updateIfFresh(set, options.id, options.token, (r) => {
        r.events = appendRepoEvent(r.events, errorEvent(message))
      })
    }
  })()
}

async function runSnapshotVisibleDetailBackfill(
  get: ReposGet,
  options: { id: string; token: number; isSnapshotCurrent: () => boolean; skipLogBackfill?: boolean },
): Promise<void> {
  void options.skipLogBackfill
  if (!options.isSnapshotCurrent() || !repoFresh(get, options.id, options.token)) return
  await refreshVisibleDetailPullRequest(get, options.id, options.token)
}

export async function runRefreshAllWorkflow(get: ReposGet, options: { id: string; token: number }): Promise<void> {
  await get().refreshSnapshot(options.id, { skipLogBackfill: true, token: options.token })
  const after = get().repos[options.id]
  if (!after || after.instanceToken !== options.token) return
  if (after.availability.phase === 'unavailable') return
  await get().refreshStatus(options.id, { token: options.token })
}
