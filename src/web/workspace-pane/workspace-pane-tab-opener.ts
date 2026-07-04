import { useReposStore } from '#/web/stores/repos/store.ts'
import { tabOpenerScopeKey } from '#/web/stores/repos/tab-opener.ts'
import { activeWorkspacePaneTabTarget } from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { hasFreshRepoInstance, type RepoInstanceHandle } from '#/web/stores/repos/repo-guards.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'

// Chrome-tab-style "opener" tracking, covering every workspace pane tab
// (static and terminal), factored out of both the tab-creation paths
// (`runCreateTerminalTabCommand`, `openWorkspacePaneTab`) and the tab-close
// commands so none of them need to duplicate this bookkeeping. Kept
// dependency-free of `workspace-commands.ts`/`terminal-create-command.ts` to
// avoid a cycle between them.

export type WorkspacePaneTabOpenerRecordResult = 'recorded' | 'missing' | 'stale-instance' | 'unavailable'

/** Snapshots the identity of the tab currently active for `repoId`. Callers
 *  must capture this *before* switching into the newly-opened tab (e.g.
 *  before calling `runShowWorkspacePaneTabCommand`), otherwise the "opener"
 *  would incorrectly resolve to the new tab itself. */
export function captureWorkspacePaneActiveTabIdentity(repoId: string): string | null {
  return activeWorkspacePaneTabTarget(repoId)?.activeTab?.identity ?? null
}

/** Records that `childIdentity` (any static or terminal tab identity) was
 *  opened from `openerIdentity` on `repoId`/`branchName`'s tab strip.
 *  Closing the tab prefers reactivating that opener (see
 *  `runCloseWorkspacePaneTabCommand`) over the generic adjacent-tab
 *  fallback.
 *
 *  `branchName` must be the branch the operation actually targets, captured
 *  by the caller *before* any `await` — not re-derived from "the repo's
 *  currently selected branch" at call time, which could have changed across
 *  an intervening async gap (e.g. the user switched branches while a tab
 *  commit was in flight) and would silently record into the wrong scope. */
export function recordWorkspacePaneTabOpener(
  repoId: string,
  branchName: string,
  childIdentity: string,
  openerIdentity: string,
  repoInstance?: RepoInstanceHandle | null,
): WorkspacePaneTabOpenerRecordResult {
  const state = useReposStore.getState()
  const repo = state.repos[repoId]
  if (!repo) return 'missing'
  if (repoInstance && !hasFreshRepoInstance(state, repoInstance)) return 'stale-instance'
  const branchModel = readRepoBranchQueryProjection(repo)
  if (!branchModel) return 'unavailable'
  if (!branchModel.branches.some((branch) => branch.name === branchName)) return 'missing'
  state.setTabOpener(tabOpenerScopeKey(repoId, branchName), childIdentity, openerIdentity)
  return 'recorded'
}

/** Reads the recorded opener for a closing tab's identity on `repoId`/`branchName`'s
 *  tab strip, if any. See `recordWorkspacePaneTabOpener` for why `branchName`
 *  must be passed explicitly rather than re-derived at call time. */
export function workspacePaneTabOpener(repoId: string, branchName: string, closingIdentity: string): string | null {
  const scopeKey = tabOpenerScopeKey(repoId, branchName)
  return useReposStore.getState().tabOpenerIdentityByScope[scopeKey]?.[closingIdentity] ?? null
}

/** Clears a tab's recorded opener, e.g. once the tab has actually closed. */
export function clearWorkspacePaneTabOpener(repoId: string, branchName: string, childIdentity: string): void {
  useReposStore.getState().clearTabOpener(tabOpenerScopeKey(repoId, branchName), childIdentity)
}
