import { computed, toValue, watch } from 'vue'
import type { ComputedRef, MaybeRefOrGetter } from 'vue'
import { useRouter } from 'vue-router'
import { isEqual } from 'es-toolkit'
import type { AppRouteNavigation, AppRouteNavigationOptions } from '#/web/app-route-navigation.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import type { WorkspaceNavigationHistoryEntry } from '#/web/stores/workspaces/types.ts'
import { getRepoSnapshotQueryData } from '#/web/repo-query-cache.ts'
import { formatTerminalFilesystemTargetKeyForPath } from '#/shared/terminal-filesystem-target-key.ts'
import { isWorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import { workspaceNavigationHistoryEntryEqual } from '#/web/stores/workspaces/navigation-history-entry.ts'
import type { WorkspacePaneRoute } from '#/web/App.tsx'
import { workspacePaneRouteNavigationBlockedForBranch } from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { consumeAppHistoryPresentationAction } from '#/web/app-history-presentation.ts'
import type { AppHistoryPresentationAction } from '#/web/app-history-presentation.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { useStoreSelector } from '#/web/stores/store-selector.ts'

export type WorkspaceNavigationRouteContext =
  | { kind: 'empty'; workspaceId: WorkspaceId }
  | { kind: 'workspace-root'; workspaceId: WorkspaceId; workspacePaneRoute: WorkspacePaneRoute | null }
  | { kind: 'dashboard'; workspaceId: WorkspaceId }
  | { kind: 'newWorktree'; workspaceId: WorkspaceId; returnTo: string | null }
  | { kind: 'worktree'; workspaceId: WorkspaceId; worktreePath: string; workspacePaneRoute: WorkspacePaneRoute | null }
  | {
      kind: 'branch'
      workspaceId: WorkspaceId
      branchName: string
      worktreePath?: string | null
      workspacePaneRoute: WorkspacePaneRoute | null
    }

interface WorkspaceNavigationHistoryOptions {
  routeContext: MaybeRefOrGetter<WorkspaceNavigationRouteContext | null>
  replaceCurrent?: MaybeRefOrGetter<boolean>
  replaceCurrentRouteContext?: MaybeRefOrGetter<WorkspaceNavigationRouteContext | null>
}

type WorkspaceNavigationBrowserHistoryTraversal = 'back' | 'forward'

export function useWorkspaceNavigationHistory({
  routeContext,
  replaceCurrent = false,
  replaceCurrentRouteContext = null,
}: WorkspaceNavigationHistoryOptions): void {
  const entry = useWorkspaceNavigationHistoryEntry(routeContext)
  const replaceCurrentEntry = useWorkspaceNavigationHistoryEntry(replaceCurrentRouteContext)
  const router = useRouter()

  // Route settlement is the authoritative point at which a workspace history
  // projection may be recorded. The watcher is required to follow that
  // external router/store combination; it does not mirror state locally.
  watch(
    [entry, replaceCurrentEntry, () => router.currentRoute.value.fullPath, () => toValue(replaceCurrent)],
    () => {
      const nextEntry = entry.value
      if (!nextEntry) return
      const browserHistoryAction = consumeAppHistoryPresentationAction(router.options.history)
      const currentHistoryEntry =
        workspacesStore.getState().navigationHistoryByWorkspace[nextEntry.workspaceId]?.current ?? null
      const browserHistoryTraversal = workspaceNavigationBrowserHistoryTraversal(browserHistoryAction)
      const browserHistoryReplace = browserHistoryAction?.type === 'REPLACE'
      const replaceCurrentMatches =
        toValue(replaceCurrent) &&
        !!replaceCurrentEntry.value &&
        workspaceNavigationHistoryEntryEqual(currentHistoryEntry, replaceCurrentEntry.value)
      const recordWorkspaceNavigation = workspacesStore.getState().recordWorkspaceNavigation
      if (browserHistoryTraversal && toValue(replaceCurrent) && replaceCurrentEntry.value) {
        if (!replaceCurrentMatches) {
          recordWorkspaceNavigation(replaceCurrentEntry.value, { browserHistoryTraversal })
        }
        const restoredCurrent =
          workspacesStore.getState().navigationHistoryByWorkspace[nextEntry.workspaceId]?.current ?? null
        if (workspaceNavigationHistoryEntryEqual(restoredCurrent, replaceCurrentEntry.value)) {
          recordWorkspaceNavigation(nextEntry, { replace: true })
        } else if (!workspaceNavigationHistoryEntryEqual(restoredCurrent, nextEntry)) {
          recordWorkspaceNavigation(nextEntry)
        }
        return
      }
      recordWorkspaceNavigation(
        nextEntry,
        replaceCurrentMatches || browserHistoryReplace
          ? { replace: true }
          : browserHistoryTraversal
            ? { browserHistoryTraversal }
            : undefined,
      )
    },
    { immediate: true },
  )
}

function useWorkspaceNavigationHistoryEntry(
  routeContext: MaybeRefOrGetter<WorkspaceNavigationRouteContext | null>,
): ComputedRef<WorkspaceNavigationHistoryEntry | null> {
  const storeState = useStoreSelector(workspacesStore, (state) => state)
  const snapshot = computed(() => {
    const currentRouteContext = toValue(routeContext)
    if (!currentRouteContext) return null
    const repo = storeState.value.workspaces[currentRouteContext.workspaceId]
    if (!repo) return null
    return workspaceNavigationHistoryRouteSnapshotFromContext({
      routeContext: currentRouteContext,
      workspaceId: repo.id,
    })
  })
  let previousSnapshot: WorkspaceNavigationHistoryRouteSnapshot | null = null
  let previousEntry: WorkspaceNavigationHistoryEntry | null = null
  return computed(() => {
    if (workspaceNavigationHistoryRouteSnapshotEqual(previousSnapshot, snapshot.value)) return previousEntry
    previousSnapshot = snapshot.value
    previousEntry = workspaceNavigationHistoryEntryFromSnapshot(snapshot.value)
    return previousEntry
  })
}

type WorkspaceNavigationHistoryRouteSnapshot =
  | { workspaceId: WorkspaceId; kind: 'empty' | 'dashboard' }
  | {
      workspaceId: WorkspaceId
      kind: 'workspace-root'
      workspacePaneTab: WorkspacePaneTabType | null
      terminalSessionId: string | null
    }
  | { workspaceId: WorkspaceId; kind: 'newWorktree'; returnTo: string | null }
  | {
      workspaceId: WorkspaceId
      kind: 'worktree'
      worktreePath: string
      workspacePaneTab: WorkspacePaneTabType | null
      terminalSessionId: string | null
    }
  | {
      workspaceId: WorkspaceId
      kind: 'branch'
      branchName: string
      workspacePaneTab: WorkspacePaneTabType | null
      terminalFilesystemTargetKey: string | null
      terminalSessionId: string | null
    }

function workspaceNavigationHistoryRouteSnapshotFromContext({
  routeContext,
  workspaceId,
}: {
  routeContext: WorkspaceNavigationRouteContext
  workspaceId: WorkspaceId
}): WorkspaceNavigationHistoryRouteSnapshot | null {
  switch (routeContext.kind) {
    case 'empty':
      return { workspaceId, kind: 'empty' }
    case 'workspace-root':
      return {
        workspaceId,
        kind: 'workspace-root',
        ...workspaceNavigationPaneSelection(routeContext.workspacePaneRoute),
      }
    case 'dashboard':
      return { workspaceId, kind: 'dashboard' }
    case 'newWorktree':
      return { workspaceId, kind: 'newWorktree', returnTo: routeContext.returnTo }
    case 'worktree': {
      const route = routeContext.workspacePaneRoute
      return {
        workspaceId,
        kind: 'worktree',
        worktreePath: routeContext.worktreePath,
        ...workspaceNavigationPaneSelection(route),
      }
    }
    case 'branch': {
      const repo = workspacesStore.getState().workspaces[workspaceId]
      const branchModel =
        repo?.capability.kind === 'git' ? getRepoSnapshotQueryData(repo.id, repo.workspaceRuntimeId) : null
      const branch = branchModel?.branches.find((candidate) => candidate.name === routeContext.branchName)
      const worktreePath = routeContext.worktreePath ?? branch?.worktree?.path ?? null
      const terminalFilesystemTargetKey = worktreePath
        ? formatTerminalFilesystemTargetKeyForPath(workspaceId, worktreePath)
        : null
      const route = routeContext.workspacePaneRoute
      return {
        workspaceId,
        kind: 'branch',
        branchName: routeContext.branchName,
        ...workspaceNavigationPaneSelection(route),
        terminalFilesystemTargetKey,
      }
    }
  }
}

function workspaceNavigationPaneSelection(route: WorkspacePaneRoute | null): {
  workspacePaneTab: WorkspacePaneTabType | null
  terminalSessionId: string | null
} {
  if (route?.kind === 'terminal') {
    return { workspacePaneTab: 'terminal', terminalSessionId: route.terminalSessionId }
  }
  if (route?.kind === 'static') return { workspacePaneTab: route.tab, terminalSessionId: null }
  return { workspacePaneTab: null, terminalSessionId: null }
}

function workspaceNavigationHistoryEntryFromSnapshot(
  snapshot: WorkspaceNavigationHistoryRouteSnapshot | null,
): WorkspaceNavigationHistoryEntry | null {
  if (!snapshot) return null
  switch (snapshot.kind) {
    case 'empty':
    case 'dashboard':
      return { workspaceId: snapshot.workspaceId, route: { kind: snapshot.kind } }
    case 'workspace-root':
      return {
        workspaceId: snapshot.workspaceId,
        route: {
          kind: 'workspace-root',
          workspacePaneTab: snapshot.workspacePaneTab,
          terminalSessionId: snapshot.terminalSessionId,
        },
      }
    case 'newWorktree':
      return { workspaceId: snapshot.workspaceId, route: { kind: 'newWorktree', returnTo: snapshot.returnTo } }
    case 'worktree':
      return {
        workspaceId: snapshot.workspaceId,
        route: {
          kind: 'worktree',
          worktreePath: snapshot.worktreePath,
          workspacePaneTab: snapshot.workspacePaneTab,
          terminalSessionId: snapshot.terminalSessionId,
        },
      }
    case 'branch':
      return {
        workspaceId: snapshot.workspaceId,
        route: {
          kind: 'branch',
          branchName: snapshot.branchName,
          workspacePaneTab: snapshot.workspacePaneTab,
          terminalFilesystemTargetKey: snapshot.terminalFilesystemTargetKey,
          terminalSessionId: snapshot.terminalSessionId,
        },
      }
  }
}

function workspaceNavigationHistoryRouteSnapshotEqual(
  a: WorkspaceNavigationHistoryRouteSnapshot | null,
  b: WorkspaceNavigationHistoryRouteSnapshot | null,
): boolean {
  return isEqual(a, b)
}

export function restoreWorkspaceNavigationEntry(
  entry: WorkspaceNavigationHistoryEntry,
  routeNavigation: AppRouteNavigation,
  options?: AppRouteNavigationOptions,
): WorkspaceNavigationRestoreResult {
  if (workspaceNavigationEntryBlocksWorkspacePaneInteraction(entry)) return { kind: 'blocked' }
  switch (entry.route.kind) {
    case 'empty':
      routeNavigation.openWorkspaceNavigator(entry.workspaceId, options)
      return { kind: 'accepted' }
    case 'workspace-root':
      if (entry.route.workspacePaneTab === 'terminal' && entry.route.terminalSessionId) {
        return routeNavigation.openWorkspaceRootTerminal(entry.workspaceId, entry.route.terminalSessionId, options)
          ? { kind: 'accepted' }
          : { kind: 'unavailable' }
      }
      if (entry.route.workspacePaneTab && entry.route.workspacePaneTab !== 'terminal') {
        return routeNavigation.openWorkspaceRootTab(entry.workspaceId, entry.route.workspacePaneTab, options)
          ? { kind: 'accepted' }
          : { kind: 'unavailable' }
      }
      return routeNavigation.openWorkspaceRootPane(entry.workspaceId, options)
        ? { kind: 'accepted' }
        : { kind: 'unavailable' }
    case 'dashboard':
      routeNavigation.openWorkspaceDashboard(entry.workspaceId, options)
      return { kind: 'accepted' }
    case 'newWorktree':
      routeNavigation.openRepoNewWorktree(entry.workspaceId, { ...options, returnTo: entry.route.returnTo })
      return { kind: 'accepted' }
    case 'worktree':
      if (entry.route.workspacePaneTab === 'terminal' && entry.route.terminalSessionId) {
        const accepted = routeNavigation.openRepoWorktreeTerminal(
          entry.workspaceId,
          entry.route.worktreePath,
          entry.route.terminalSessionId,
          options,
        )
        return accepted ? { kind: 'accepted' } : { kind: 'unavailable' }
      }
      if (entry.route.workspacePaneTab && entry.route.workspacePaneTab !== 'terminal') {
        const accepted = routeNavigation.openRepoWorktreeTab(
          entry.workspaceId,
          entry.route.worktreePath,
          entry.route.workspacePaneTab,
          options,
        )
        return accepted ? { kind: 'accepted' } : { kind: 'unavailable' }
      }
      return routeNavigation.openRepoWorktree(entry.workspaceId, entry.route.worktreePath, options)
        ? { kind: 'accepted' }
        : { kind: 'unavailable' }
    case 'branch':
      if (entry.route.workspacePaneTab === 'terminal' && entry.route.terminalSessionId) {
        const accepted = routeNavigation.openRepoBranchTerminal(
          entry.workspaceId,
          entry.route.branchName,
          entry.route.terminalSessionId,
          options,
        )
        return accepted ? { kind: 'accepted' } : { kind: 'unavailable' }
      }
      if (!entry.route.workspacePaneTab) {
        const accepted = routeNavigation.openRepoBranch(entry.workspaceId, entry.route.branchName, options)
        return accepted ? { kind: 'accepted' } : { kind: 'unavailable' }
      }
      if (!isWorkspacePaneStaticTabType(entry.route.workspacePaneTab)) {
        const accepted = routeNavigation.openRepoBranch(entry.workspaceId, entry.route.branchName, options)
        return accepted ? { kind: 'accepted' } : { kind: 'unavailable' }
      }
      const accepted = routeNavigation.openRepoBranchTab(
        entry.workspaceId,
        entry.route.branchName,
        entry.route.workspacePaneTab,
        options,
      )
      return accepted ? { kind: 'accepted' } : { kind: 'unavailable' }
  }
}

export type WorkspaceNavigationRestoreResult = { kind: 'accepted' } | { kind: 'blocked' } | { kind: 'unavailable' }

export function workspaceNavigationHistoryRestoreBlocked(
  workspaceId: WorkspaceId,
  direction: 'back' | 'forward',
): boolean {
  const history = workspacesStore.getState().navigationHistoryByWorkspace[workspaceId]
  const target = direction === 'back' ? history?.backStack.at(-1) : history?.forwardStack.at(-1)
  if (!target) return false
  return (
    workspaceNavigationEntryBlocksWorkspacePaneInteraction(history?.current ?? null) ||
    workspaceNavigationEntryBlocksWorkspacePaneInteraction(target)
  )
}

function workspaceNavigationEntryBlocksWorkspacePaneInteraction(
  entry: WorkspaceNavigationHistoryEntry | null,
): boolean {
  if (entry?.route.kind !== 'branch') return false
  if (!workspaceNavigationBranchEntryTargetsWorkspacePane(entry)) return false
  return workspacePaneRouteNavigationBlockedForBranch(entry.workspaceId, entry.route.branchName)
}

function workspaceNavigationBranchEntryTargetsWorkspacePane(entry: WorkspaceNavigationHistoryEntry): boolean {
  if (entry.route.kind !== 'branch') return false
  if (!entry.route.workspacePaneTab) return false
  if (entry.route.workspacePaneTab !== 'terminal') return true
  return !!entry.route.terminalSessionId
}

function workspaceNavigationBrowserHistoryTraversal(
  action: AppHistoryPresentationAction | null,
): WorkspaceNavigationBrowserHistoryTraversal | null {
  if (!action) return null
  if (action.type === 'BACK') return 'back'
  if (action.type === 'FORWARD') return 'forward'
  if (action.type === 'GO') {
    if (action.index < 0) return 'back'
    if (action.index > 0) return 'forward'
  }
  return null
}
