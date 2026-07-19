import { useEffect, useMemo } from 'react'
import { useRouter } from '@tanstack/react-router'
import type { HistoryState } from '@tanstack/history'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import type { PrimaryWindowRouteNavigation } from '#/web/primary-window-route-navigation.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import type { WorkspaceNavigationHistoryEntry } from '#/web/stores/workspaces/types.ts'
import { readRepoBranchSnapshotQueryProjection } from '#/web/repo-branch-read-model.ts'
import { formatTerminalWorktreeKeyForPath } from '#/shared/terminal-worktree-key.ts'
import { isWorkspacePaneStaticTabType, type WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import { workspaceNavigationHistoryEntryEqual } from '#/web/stores/workspaces/navigation-history-entry.ts'
import type { WorkspacePaneRoute } from '#/web/App.tsx'
import { workspacePaneRouteNavigationBlockedForBranch } from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import {
  observePrimaryWindowHistoryNavigation,
  type PrimaryWindowPresentationToken,
} from '#/web/primary-window-presentation.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

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
  routeContext: WorkspaceNavigationRouteContext | null
  replaceCurrent?: boolean
  replaceCurrentRouteContext?: WorkspaceNavigationRouteContext | null
}

type WorkspaceNavigationBrowserHistoryTraversal = 'back' | 'forward'
type WorkspaceNavigationBrowserHistoryAction =
  { href: string; type: 'BACK' | 'FORWARD' | 'PUSH' | 'REPLACE' } | { href: string; type: 'GO'; index: number }

interface WorkspaceNavigationRouterHistory {
  state: { location: { href: string; state: HistoryState } }
  history: {
    subscribe: (
      cb: (event: {
        location: { href: string; state: HistoryState }
        action: { type: 'BACK' | 'FORWARD' | 'PUSH' | 'REPLACE' } | { type: 'GO'; index: number }
      }) => void,
    ) => () => void
  }
}

// Router history event metadata. It is not part of terminal create/focus
// logic; it lets the route/history adapter preserve the app history cursor
// when the browser lands on a URL through Back/Forward instead of an
// app-initiated PUSH.
let browserHistoryAction: WorkspaceNavigationBrowserHistoryAction | null = null

export function useWorkspaceNavigationHistory({
  routeContext,
  replaceCurrent = false,
  replaceCurrentRouteContext = null,
}: WorkspaceNavigationHistoryOptions): void {
  const entry = useWorkspaceNavigationHistoryEntry(routeContext)
  const replaceCurrentEntry = useWorkspaceNavigationHistoryEntry(replaceCurrentRouteContext)
  const router = useRouter({ warn: false }) as WorkspaceNavigationRouterHistory | null
  const routeHref = router?.state.location.href ?? currentBrowserLocationHref()
  const recordWorkspaceNavigation = useWorkspacesStore((s) => s.recordWorkspaceNavigation)

  useEffect(() => {
    if (!entry) return
    const currentHistoryEntry =
      useWorkspacesStore.getState().navigationHistoryByWorkspace[entry.workspaceId]?.current ?? null
    const browserHistoryTraversal = workspaceNavigationBrowserHistoryTraversal(routeHref)
    const replaceCurrentMatches =
      replaceCurrent &&
      !!replaceCurrentEntry &&
      workspaceNavigationHistoryEntryEqual(currentHistoryEntry, replaceCurrentEntry)
    if (browserHistoryTraversal && replaceCurrent && replaceCurrentEntry) {
      if (!replaceCurrentMatches) {
        recordWorkspaceNavigation(replaceCurrentEntry, { browserHistoryTraversal })
      }
      const restoredCurrent =
        useWorkspacesStore.getState().navigationHistoryByWorkspace[entry.workspaceId]?.current ?? null
      if (workspaceNavigationHistoryEntryEqual(restoredCurrent, replaceCurrentEntry)) {
        recordWorkspaceNavigation(entry, { replace: true })
      } else if (!workspaceNavigationHistoryEntryEqual(restoredCurrent, entry)) {
        recordWorkspaceNavigation(entry)
      }
      clearBrowserHistoryAction(routeHref)
      return
    }
    recordWorkspaceNavigation(
      entry,
      replaceCurrentMatches ? { replace: true } : browserHistoryTraversal ? { browserHistoryTraversal } : undefined,
    )
    clearBrowserHistoryAction(routeHref)
  }, [entry, recordWorkspaceNavigation, replaceCurrent, replaceCurrentEntry, routeHref])
}

/** One primary-window subscription owns both presentation arbitration and browser traversal metadata. */
export function usePrimaryWindowHistoryPresentationObserver(): void {
  const router = useRouter({ warn: false }) as WorkspaceNavigationRouterHistory | null
  useEffect(() => {
    if (!router) return
    return router.history.subscribe(({ location, action }) => {
      observePrimaryWindowHistoryNavigation({ href: location.href, state: location.state, action })
      browserHistoryAction =
        action.type === 'GO'
          ? { href: location.href, type: 'GO', index: action.index }
          : { href: location.href, type: action.type }
    })
  }, [router])
}

function useWorkspaceNavigationHistoryEntry(
  routeContext: WorkspaceNavigationRouteContext | null,
): WorkspaceNavigationHistoryEntry | null {
  const snapshot = useStoreWithEqualityFn(
    useWorkspacesStore,
    (s) => {
      if (!routeContext) return null
      const repo = s.workspaces[routeContext.workspaceId]
      if (!repo) return null
      return workspaceNavigationHistoryRouteSnapshotFromContext({
        routeContext,
        workspaceId: repo.id,
      })
    },
    workspaceNavigationHistoryRouteSnapshotEqual,
  )
  return useMemo(() => workspaceNavigationHistoryEntryFromSnapshot(snapshot), [snapshot])
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
      terminalWorktreeKey: string | null
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
        workspacePaneTab:
          routeContext.workspacePaneRoute?.kind === 'terminal'
            ? 'terminal'
            : routeContext.workspacePaneRoute?.kind === 'static'
              ? routeContext.workspacePaneRoute.tab
              : null,
        terminalSessionId:
          routeContext.workspacePaneRoute?.kind === 'terminal'
            ? routeContext.workspacePaneRoute.terminalSessionId
            : null,
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
        workspacePaneTab: route?.kind === 'terminal' ? 'terminal' : route?.kind === 'static' ? route.tab : null,
        terminalSessionId: route?.kind === 'terminal' ? route.terminalSessionId : null,
      }
    }
    case 'branch': {
      const repo = useWorkspacesStore.getState().workspaces[workspaceId]
      const branchModel = repo?.capability.kind === 'git' ? readRepoBranchSnapshotQueryProjection(repo) : null
      const branch = branchModel?.branches.find((candidate) => candidate.name === routeContext.branchName)
      const worktreePath = routeContext.worktreePath ?? branch?.worktree?.path ?? null
      const terminalWorktreeKey = worktreePath ? formatTerminalWorktreeKeyForPath(workspaceId, worktreePath) : null
      const route = routeContext.workspacePaneRoute
      const workspacePaneTab: WorkspacePaneTabType | null =
        route?.kind === 'terminal' ? 'terminal' : route?.kind === 'static' ? route.tab : null
      return {
        workspaceId,
        kind: 'branch',
        branchName: routeContext.branchName,
        workspacePaneTab,
        terminalWorktreeKey,
        terminalSessionId: route?.kind === 'terminal' ? route.terminalSessionId : null,
      }
    }
  }
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
          terminalWorktreeKey: snapshot.terminalWorktreeKey,
          terminalSessionId: snapshot.terminalSessionId,
        },
      }
  }
}

function workspaceNavigationHistoryRouteSnapshotEqual(
  a: WorkspaceNavigationHistoryRouteSnapshot | null,
  b: WorkspaceNavigationHistoryRouteSnapshot | null,
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.workspaceId !== b.workspaceId || a.kind !== b.kind) return false
  if (a.kind === 'newWorktree' && b.kind === 'newWorktree') return a.returnTo === b.returnTo
  if (a.kind === 'worktree' && b.kind === 'worktree') {
    return (
      a.worktreePath === b.worktreePath &&
      a.workspacePaneTab === b.workspacePaneTab &&
      a.terminalSessionId === b.terminalSessionId
    )
  }
  if (a.kind === 'workspace-root' && b.kind === 'workspace-root') {
    return a.workspacePaneTab === b.workspacePaneTab && a.terminalSessionId === b.terminalSessionId
  }
  if (a.kind !== 'branch' || b.kind !== 'branch') return true
  return (
    a.branchName === b.branchName &&
    a.workspacePaneTab === b.workspacePaneTab &&
    a.terminalWorktreeKey === b.terminalWorktreeKey &&
    a.terminalSessionId === b.terminalSessionId
  )
}

export function restoreWorkspaceNavigationEntry(
  entry: WorkspaceNavigationHistoryEntry,
  routeNavigation: PrimaryWindowRouteNavigation,
  options?: { presentationToken?: PrimaryWindowPresentationToken },
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
        const accepted = routeNavigation.openRepoWorktreeTerminal?.(
          entry.workspaceId,
          entry.route.worktreePath,
          entry.route.terminalSessionId,
          options,
        )
        return accepted ? { kind: 'accepted' } : { kind: 'unavailable' }
      }
      if (entry.route.workspacePaneTab && entry.route.workspacePaneTab !== 'terminal') {
        const accepted = routeNavigation.openRepoWorktreeTab?.(
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
  const history = useWorkspacesStore.getState().navigationHistoryByWorkspace[workspaceId]
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
  routeHref: string,
): WorkspaceNavigationBrowserHistoryTraversal | null {
  const action = browserHistoryAction
  if (!action || action.href !== routeHref) return null
  if (action.type === 'BACK') return 'back'
  if (action.type === 'FORWARD') return 'forward'
  if (action.type === 'GO') {
    if (action.index < 0) return 'back'
    if (action.index > 0) return 'forward'
  }
  return null
}

function clearBrowserHistoryAction(routeHref: string): void {
  if (browserHistoryAction?.href === routeHref) browserHistoryAction = null
}

function currentBrowserLocationHref(): string {
  if (typeof window === 'undefined') return ''
  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}
