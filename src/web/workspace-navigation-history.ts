import { useEffect, useMemo } from 'react'
import { useRouter } from '@tanstack/react-router'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import type { PrimaryWindowRouteNavigation } from '#/web/primary-window-route-navigation.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { WorkspaceNavigationHistoryEntry } from '#/web/stores/repos/types.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'
import { formatTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'
import { isWorkspacePaneStaticTabType, type WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import { workspaceNavigationHistoryEntryEqual } from '#/web/stores/repos/navigation-history-entry.ts'
import type { RepoBranchWorkspacePaneRoute } from '#/web/App.tsx'
import { workspacePaneTabInteractionBlockedForBranch } from '#/web/workspace-pane/workspace-pane-tab-target.ts'

export type WorkspaceNavigationRouteContext =
  | { kind: 'empty'; repoId: string }
  | { kind: 'dashboard'; repoId: string }
  | { kind: 'newWorktree'; repoId: string; returnTo: string | null }
  | {
      kind: 'branch'
      repoId: string
      branchName: string
      worktreePath?: string | null
      workspacePaneRoute?: RepoBranchWorkspacePaneRoute | null
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
  state: { location: { href: string } }
  history: {
    subscribe: (
      cb: (event: {
        location: { href: string }
        action: { type: 'BACK' | 'FORWARD' | 'PUSH' | 'REPLACE' } | { type: 'GO'; index: number }
      }) => void,
    ) => () => void
  }
}

let restoreRecordingSuppressed = false
let restoreRecordingSuppressionTimer: ReturnType<typeof setTimeout> | null = null
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
  const recordWorkspaceNavigation = useReposStore((s) => s.recordWorkspaceNavigation)

  useEffect(() => {
    if (!router) return
    return router.history.subscribe(({ location, action }) => {
      browserHistoryAction =
        action.type === 'GO'
          ? { href: location.href, type: 'GO', index: action.index }
          : { href: location.href, type: action.type }
    })
  }, [router])

  useEffect(() => {
    if (!entry) return
    const currentHistoryEntry = useReposStore.getState().navigationHistoryByRepo[entry.repoId]?.current ?? null
    const browserHistoryTraversal = workspaceNavigationBrowserHistoryTraversal(routeHref)
    const replaceCurrentMatches =
      replaceCurrent &&
      !!replaceCurrentEntry &&
      workspaceNavigationHistoryEntryEqual(currentHistoryEntry, replaceCurrentEntry)
    if (restoreRecordingSuppressed) {
      if (replaceCurrentMatches) {
        recordWorkspaceNavigation(entry, { replace: true })
        clearBrowserHistoryAction(routeHref)
        clearRestoreRecordingSuppression()
        return
      }
      const historyCurrent = useReposStore.getState().navigationHistoryByRepo[entry.repoId]?.current ?? null
      if (workspaceNavigationHistoryEntryEqual(historyCurrent, entry)) {
        clearBrowserHistoryAction(routeHref)
        clearRestoreRecordingSuppression()
        return
      }
      recordWorkspaceNavigation(entry, browserHistoryTraversal ? { browserHistoryTraversal } : undefined)
      clearBrowserHistoryAction(routeHref)
      clearRestoreRecordingSuppression()
      return
    }
    if (browserHistoryTraversal && replaceCurrent && replaceCurrentEntry) {
      if (!replaceCurrentMatches) {
        recordWorkspaceNavigation(replaceCurrentEntry, { browserHistoryTraversal })
      }
      const restoredCurrent = useReposStore.getState().navigationHistoryByRepo[entry.repoId]?.current ?? null
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

function useWorkspaceNavigationHistoryEntry(
  routeContext: WorkspaceNavigationRouteContext | null,
): WorkspaceNavigationHistoryEntry | null {
  const snapshot = useStoreWithEqualityFn(
    useReposStore,
    (s) => {
      if (!routeContext) return null
      const repo = s.repos[routeContext.repoId]
      if (!repo) return null
      return workspaceNavigationHistoryRouteSnapshotFromContext({
        routeContext,
        repoId: repo.id,
      })
    },
    workspaceNavigationHistoryRouteSnapshotEqual,
  )
  return useMemo(() => workspaceNavigationHistoryEntryFromSnapshot(snapshot), [snapshot])
}

type WorkspaceNavigationHistoryRouteSnapshot =
  | { repoId: string; kind: 'empty' | 'dashboard' }
  | { repoId: string; kind: 'newWorktree'; returnTo: string | null }
  | {
      repoId: string
      kind: 'branch'
      branchName: string
      workspacePaneTab: WorkspacePaneTabType | null
      terminalWorktreeKey: string | null
      terminalSessionId: string | null
    }

function workspaceNavigationHistoryRouteSnapshotFromContext({
  routeContext,
  repoId,
}: {
  routeContext: WorkspaceNavigationRouteContext
  repoId: string
}): WorkspaceNavigationHistoryRouteSnapshot | null {
  switch (routeContext.kind) {
    case 'empty':
      return { repoId, kind: 'empty' }
    case 'dashboard':
      return { repoId, kind: 'dashboard' }
    case 'newWorktree':
      return { repoId, kind: 'newWorktree', returnTo: routeContext.returnTo }
    case 'branch': {
      const repo = useReposStore.getState().repos[repoId]
      const branchModel = repo ? readRepoBranchQueryProjection(repo) : null
      const branch = branchModel?.branches.find((candidate) => candidate.name === routeContext.branchName)
      const worktreePath = routeContext.worktreePath ?? branch?.worktree?.path ?? null
      const terminalWorktreeKey = worktreePath ? formatTerminalWorktreeKey(repoId, worktreePath) : null
      const route = routeContext.workspacePaneRoute ?? null
      const workspacePaneTab: WorkspacePaneTabType | null =
        route?.kind === 'terminal' ? 'terminal' : route?.kind === 'static' ? route.tab : null
      return {
        repoId,
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
      return { repoId: snapshot.repoId, route: { kind: snapshot.kind } }
    case 'newWorktree':
      return { repoId: snapshot.repoId, route: { kind: 'newWorktree', returnTo: snapshot.returnTo } }
    case 'branch':
      return {
        repoId: snapshot.repoId,
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
  if (a.repoId !== b.repoId || a.kind !== b.kind) return false
  if (a.kind === 'newWorktree' && b.kind === 'newWorktree') return a.returnTo === b.returnTo
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
): void {
  if (workspaceNavigationEntryBlocksWorkspacePaneInteraction(entry)) return
  suppressRestoreRecording()
  switch (entry.route.kind) {
    case 'empty':
      routeNavigation.openRepoRoot(entry.repoId)
      return
    case 'dashboard':
      routeNavigation.openRepoDashboard(entry.repoId)
      return
    case 'newWorktree':
      routeNavigation.openRepoNewWorktree(entry.repoId, { returnTo: entry.route.returnTo })
      return
    case 'branch':
      if (entry.route.workspacePaneTab === 'terminal' && entry.route.terminalSessionId) {
        routeNavigation.openRepoBranchTerminal(entry.repoId, entry.route.branchName, entry.route.terminalSessionId)
        return
      }
      if (!entry.route.workspacePaneTab) {
        routeNavigation.openRepoBranch(entry.repoId, entry.route.branchName)
        return
      }
      routeNavigation.openRepoBranchTab(
        entry.repoId,
        entry.route.branchName,
        isWorkspacePaneStaticTabType(entry.route.workspacePaneTab) ? entry.route.workspacePaneTab : 'status',
      )
      return
  }
}

export function workspaceNavigationHistoryRestoreBlocked(repoId: string, direction: 'back' | 'forward'): boolean {
  const history = useReposStore.getState().navigationHistoryByRepo[repoId]
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
  return entry?.route.kind === 'branch'
    ? workspacePaneTabInteractionBlockedForBranch(entry.repoId, entry.route.branchName)
    : false
}

function suppressRestoreRecording(): void {
  restoreRecordingSuppressed = true
  if (restoreRecordingSuppressionTimer !== null) clearTimeout(restoreRecordingSuppressionTimer)
  restoreRecordingSuppressionTimer = setTimeout(() => {
    restoreRecordingSuppressionTimer = null
    restoreRecordingSuppressed = false
  }, 500)
}

function clearRestoreRecordingSuppression(): void {
  restoreRecordingSuppressed = false
  if (restoreRecordingSuppressionTimer === null) return
  clearTimeout(restoreRecordingSuppressionTimer)
  restoreRecordingSuppressionTimer = null
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
