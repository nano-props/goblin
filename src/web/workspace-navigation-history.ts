import { useEffect, useMemo } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import type { PrimaryWindowRouteNavigation } from '#/web/primary-window-route-navigation.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { WorkspaceNavigationHistoryEntry } from '#/web/stores/repos/types.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'
import { preferredWorkspacePaneTabForTarget } from '#/web/stores/repos/workspace-pane-preferences.ts'
import { formatTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'
import type { WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import { workspaceNavigationHistoryEntryEqual } from '#/web/stores/repos/navigation-history-entry.ts'

export type WorkspaceNavigationRouteContext =
  | { kind: 'empty'; repoId: string }
  | { kind: 'dashboard'; repoId: string }
  | { kind: 'newWorktree'; repoId: string; returnTo: string | null }
  | { kind: 'branch'; repoId: string; branchName: string; worktreePath?: string | null }

interface WorkspaceNavigationHistoryOptions {
  routeContext: WorkspaceNavigationRouteContext | null
}

let restoreRecordingSuppressed = false
let restoreRecordingSuppressionTimer: ReturnType<typeof setTimeout> | null = null

export function useWorkspaceNavigationHistory({
  routeContext,
}: WorkspaceNavigationHistoryOptions): void {
  const entry = useWorkspaceNavigationHistoryEntry(routeContext)
  const recordWorkspaceNavigation = useReposStore((s) => s.recordWorkspaceNavigation)

  useEffect(() => {
    if (!entry) return
    if (restoreRecordingSuppressed) {
      const historyCurrent = useReposStore.getState().navigationHistoryByRepo[entry.repoId]?.current ?? null
      if (workspaceNavigationHistoryEntryEqual(historyCurrent, entry)) clearRestoreRecordingSuppression()
      return
    }
    recordWorkspaceNavigation(entry)
  }, [entry, recordWorkspaceNavigation])
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
        repoUi: repo.ui,
        selectedTerminalSessionIdByTerminalWorktree: s.selectedTerminalSessionIdByTerminalWorktree,
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
  repoUi,
  selectedTerminalSessionIdByTerminalWorktree,
}: {
  routeContext: WorkspaceNavigationRouteContext
  repoId: string
  repoUi: Parameters<typeof preferredWorkspacePaneTabForTarget>[0]
  selectedTerminalSessionIdByTerminalWorktree: Record<string, string>
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
      const workspacePaneTab = preferredWorkspacePaneTabForTarget(repoUi, {
        repoRoot: repoId,
        branchName: routeContext.branchName,
        worktreePath,
      })
      const terminalWorktreeKey = worktreePath ? formatTerminalWorktreeKey(repoId, worktreePath) : null
      return {
        repoId,
        kind: 'branch',
        branchName: routeContext.branchName,
        workspacePaneTab,
        terminalWorktreeKey,
        terminalSessionId: terminalWorktreeKey
          ? (selectedTerminalSessionIdByTerminalWorktree[terminalWorktreeKey] ?? null)
          : null,
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
      routeNavigation.openRepoBranch(entry.repoId, entry.route.branchName)
      if (entry.route.workspacePaneTab) {
        useReposStore.getState().setWorkspacePaneTab(entry.repoId, entry.route.branchName, entry.route.workspacePaneTab)
      }
      if (entry.route.terminalWorktreeKey) {
        useReposStore
          .getState()
          .setSelectedTerminal(entry.route.terminalWorktreeKey, entry.route.terminalSessionId)
      }
      return
  }
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
