import {
  isWorkspacePaneRuntimeTabEntry,
  workspacePaneStaticTabId,
  workspacePaneTabEntryIdentity,
} from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { tabOpenerScopeKey } from '#/web/stores/repos/tab-opener.ts'
import { preferredWorkspacePaneTabForTarget } from '#/web/stores/repos/workspace-pane-preferences.ts'
import type { WorkspacePaneTabTargetOptions } from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { readWorkspacePaneTabsProjectionForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'

export type WorkspacePaneTabOpenerRecordResult = 'recorded' | 'missing'

/**
 * Reads the active identity from one canonical pane target. The target is the
 * authority for the tab strip: opener bookkeeping must never rediscover it
 * through a branch snapshot, because worktrees can be detached or renamed.
 */
export function captureWorkspacePaneActiveTabIdentity(
  target: WorkspacePaneTabsTarget,
  workspaceRuntimeId: string,
  options: WorkspacePaneTabTargetOptions,
): string | null {
  const repo = useReposStore.getState().repos[target.repoRoot]
  if (!repo || repo.repoRuntimeId !== workspaceRuntimeId) return null
  const projection = readWorkspacePaneTabsProjectionForTarget({ ...target, repoRuntimeId: workspaceRuntimeId })
  if (projection.phase !== 'ready') return null
  const tabs = projection.tabs
  const route = options.workspacePaneRoute
  if (route === null) return null
  if (route?.kind === 'static') {
    const identity = workspacePaneStaticTabId(route.tab)
    return tabs.some((entry) => workspacePaneTabEntryIdentity(entry) === identity) ? identity : null
  }
  if (route?.kind === 'terminal') {
    const entry = tabs.find(
      (candidate) =>
        isWorkspacePaneRuntimeTabEntry(candidate) && candidate.runtimeSessionId === route.terminalSessionId,
    )
    return entry ? workspacePaneTabEntryIdentity(entry) : null
  }
  const preferred = preferredWorkspacePaneTabForTarget(repo.ui, target)
  const entry = tabs.find((candidate) => candidate.type === preferred)
  return entry ? workspacePaneTabEntryIdentity(entry) : null
}

export function recordWorkspacePaneTabOpener(
  target: WorkspacePaneTabsTarget,
  workspaceRuntimeId: string,
  childIdentity: string,
  openerIdentity: string,
): WorkspacePaneTabOpenerRecordResult {
  const state = useReposStore.getState()
  const repo = state.repos[target.repoRoot]
  if (!repo || repo.repoRuntimeId !== workspaceRuntimeId) return 'missing'
  state.setTabOpener(runtimeScopedTabOpenerKey(target, workspaceRuntimeId), childIdentity, openerIdentity)
  return 'recorded'
}

export function workspacePaneTabOpener(
  target: WorkspacePaneTabsTarget,
  workspaceRuntimeId: string,
  closingIdentity: string,
): string | null {
  const scopeKey = runtimeScopedTabOpenerKey(target, workspaceRuntimeId)
  return useReposStore.getState().tabOpenerIdentityByScope[scopeKey]?.[closingIdentity] ?? null
}

export function clearWorkspacePaneTabOpener(
  target: WorkspacePaneTabsTarget,
  workspaceRuntimeId: string,
  childIdentity: string,
): void {
  useReposStore.getState().clearTabOpener(runtimeScopedTabOpenerKey(target, workspaceRuntimeId), childIdentity)
}

function runtimeScopedTabOpenerKey(target: WorkspacePaneTabsTarget, workspaceRuntimeId: string): string {
  return `${tabOpenerScopeKey(target)}\0${workspaceRuntimeId}`
}
