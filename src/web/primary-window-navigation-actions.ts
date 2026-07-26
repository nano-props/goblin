import type { WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { SettingsPage } from '#/shared/settings-pages.ts'
import type { ParsedWorkspacePaneRouteTarget, WorkspacePaneRouteTarget } from '#/web/App.tsx'
import type {
  FilesystemWorkspacePaneRouteTarget,
  PrimaryWindowRouteNavigation,
} from '#/web/primary-window-route-navigation.ts'
import type { CloseWorkspaceResult, WorkspaceNavigationHistoryTraversal } from '#/web/stores/workspaces/types.ts'
import {
  restoreWorkspaceNavigationEntry,
  workspaceNavigationHistoryRestoreBlocked,
} from '#/web/workspace-navigation-history.ts'
import {
  filesystemWorkspacePaneTargetLeaseCurrentness,
  workspaceRootPaneTargetLease,
  type FilesystemWorkspacePaneTargetLease,
  type WorkspacePaneTargetCurrentness,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { openWorkspacePaneRoute } from '#/web/workspace-pane/repo-branch-workspace-pane-route.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { formatTerminalFilesystemTargetKeyForPath } from '#/shared/terminal-filesystem-target-key.ts'
import {
  beginPrimaryWindowNavigationIntent,
  commitPrimaryWindowNavigationEffect,
  type PrimaryWindowNavigationIntent,
} from '#/web/primary-window-navigation-lifecycle.ts'

export interface PrimaryWindowNavigationOptions {
  replace?: boolean
  navigationIntent?: PrimaryWindowNavigationIntent
  /**
   * Once an action receives these effects, it owns their normal settlement:
   * accepted navigation invokes `onCommit`, rejected/abandoned navigation
   * invokes `onAbandon`, and neither result is settled again by its caller.
   */
  onCommit?: () => void
  onAbandon?: () => void
  /** Reports a transient authority loss to the transaction that owns this commit. */
  onTargetPending?: () => void
  /** Additional authority admitted before navigation and used to scope its local commit supplement. */
  presentationCurrentness?: () => WorkspacePaneTargetCurrentness
  routePrecondition?:
    { kind: 'exact-route'; route: ParsedWorkspacePaneRouteTarget } | { kind: 'current-workspace-target' }
}

export type WorkspaceRootPanePresentation =
  { kind: 'static'; tab: WorkspacePaneStaticTabType } | { kind: 'terminal'; terminalSessionId: string }

export type FilesystemWorkspacePaneCommitTarget = FilesystemWorkspacePaneTargetLease

export interface PrimaryWindowNavigationActions {
  activateWorkspace: (workspaceId: WorkspaceId) => void
  closeWorkspace: (workspaceId: WorkspaceId) => Promise<CloseWorkspaceResult>
  cycleWorkspace: (direction: 1 | -1) => void
  selectRepoBranch: (workspaceId: WorkspaceId, branch: string, options?: { replace?: boolean }) => boolean
  showRepoWorktreeTerminalSession: (
    workspaceId: WorkspaceId,
    worktreePath: string,
    terminalSessionId: string,
    options?: PrimaryWindowNavigationOptions,
  ) => boolean
  showWorkspaceRootPaneTab: (
    workspaceId: WorkspaceId,
    presentation: WorkspaceRootPanePresentation,
    options?: PrimaryWindowNavigationOptions,
  ) => boolean
  commitFilesystemWorkspacePaneRoute: (
    target: FilesystemWorkspacePaneCommitTarget,
    route: WorkspacePaneRouteTarget,
    options?: PrimaryWindowNavigationOptions,
  ) => Promise<boolean>
  commitWorkspaceRootTerminalSession: (
    workspaceId: WorkspaceId,
    workspaceRuntimeId: string,
    terminalSessionId: string,
    options?: PrimaryWindowNavigationOptions,
  ) => Promise<boolean>
  commitWorkspacePaneRoute: (
    workspaceId: WorkspaceId,
    branch: string,
    route: WorkspacePaneRouteTarget,
    options?: PrimaryWindowNavigationOptions,
  ) => Promise<boolean>
  currentWorkspacePaneRoute: (workspaceId: WorkspaceId, branch: string) => WorkspacePaneRouteTarget | undefined
  goBack: (workspaceId: WorkspaceId) => void
  goForward: (workspaceId: WorkspaceId) => void
  openSettings: (page: SettingsPage) => void
  openCreateWorktree: () => void
}

interface CreatePrimaryWindowNavigationActionsOptions {
  currentWorkspaceId: WorkspaceId | null
  workspaceOrder: WorkspaceId[]
  closeWorkspace: (workspaceId: WorkspaceId) => Promise<CloseWorkspaceResult>
  peekWorkspaceNavigation: (
    workspaceId: WorkspaceId,
    direction: 'back' | 'forward',
  ) => WorkspaceNavigationHistoryTraversal | null
  commitWorkspaceNavigation: (traversal: WorkspaceNavigationHistoryTraversal) => boolean
  routeNavigation: PrimaryWindowRouteNavigation
}

export function createPrimaryWindowNavigationActions({
  currentWorkspaceId,
  workspaceOrder,
  closeWorkspace,
  peekWorkspaceNavigation,
  commitWorkspaceNavigation,
  routeNavigation,
}: CreatePrimaryWindowNavigationActionsOptions): PrimaryWindowNavigationActions {
  return {
    currentWorkspacePaneRoute(workspaceId, branchName) {
      return routeNavigation.currentWorkspacePaneRoute(workspaceId, branchName)
    },
    activateWorkspace(workspaceId) {
      const navigationIntent = beginPrimaryWindowNavigationIntent('user')
      restoreWorkspacePresentationOrOpenDashboard(workspaceId, routeNavigation, navigationIntent, {
        onBlocked: 'stay',
      })
    },
    async closeWorkspace(workspaceId) {
      const nextWorkspaceId =
        workspaceId === currentWorkspaceId ? nextWorkspaceIdAfterClose(workspaceOrder, workspaceId) : null
      const navigationIntent = workspaceId === currentWorkspaceId ? beginPrimaryWindowNavigationIntent('user') : null
      let handedOffNavigation = false
      try {
        const result = await closeWorkspace(workspaceId)
        if (!result.ok || workspaceId !== currentWorkspaceId || !navigationIntent) return result
        handedOffNavigation = true
        if (nextWorkspaceId)
          restoreWorkspacePresentationOrOpenDashboard(nextWorkspaceId, routeNavigation, navigationIntent, {
            onBlocked: 'dashboard',
          })
        else
          routeNavigation.openHome({
            navigationIntent,
          })
        return result
      } finally {
        if (!handedOffNavigation) navigationIntent?.release()
      }
    },
    cycleWorkspace(direction) {
      const workspaceId = nextNavigationWorkspaceId(workspaceOrder, currentWorkspaceId, direction)
      if (workspaceId) {
        const navigationIntent = beginPrimaryWindowNavigationIntent('user')
        restoreWorkspacePresentationOrOpenDashboard(workspaceId, routeNavigation, navigationIntent, {
          onBlocked: 'stay',
        })
      }
    },
    selectRepoBranch(workspaceId, branch, options) {
      const navigationIntent = beginPrimaryWindowNavigationIntent('user')
      const accepted = openWorkspacePaneRoute(routeNavigation, workspaceId, branch, { ...options, navigationIntent })
      if (!accepted) navigationIntent.release()
      return accepted
    },
    showRepoWorktreeTerminalSession(workspaceId, worktreePath, terminalSessionId, options) {
      const navigationIntent = options?.navigationIntent ?? beginPrimaryWindowNavigationIntent('user')
      return routeNavigation.openRepoWorktreeTerminal(workspaceId, worktreePath, terminalSessionId, {
        ...options,
        navigationIntent,
      })
    },
    showWorkspaceRootPaneTab(workspaceId, presentation, options) {
      const navigationIntent = options?.navigationIntent ?? beginPrimaryWindowNavigationIntent('user')
      const navigationOptions = workspaceRootPanePresentationOptions(
        workspaceId,
        presentation,
        options,
        navigationIntent,
      )
      return presentation.kind === 'terminal'
        ? routeNavigation.openWorkspaceRootTerminal(workspaceId, presentation.terminalSessionId, navigationOptions)
        : routeNavigation.openWorkspaceRootTab(workspaceId, presentation.tab, navigationOptions)
    },
    async commitFilesystemWorkspacePaneRoute(target, route, options) {
      return await commitFilesystemWorkspacePaneRoute(routeNavigation, target, route, options)
    },
    async commitWorkspaceRootTerminalSession(workspaceId, workspaceRuntimeId, terminalSessionId, options) {
      return await commitFilesystemWorkspacePaneRoute(
        routeNavigation,
        workspaceRootPaneTargetLease(workspaceId, workspaceRuntimeId),
        { kind: 'terminal', terminalSessionId },
        options,
      )
    },
    commitWorkspacePaneRoute(workspaceId, branch, route, options) {
      return commitWorkspacePaneRoute(routeNavigation, workspaceId, branch, route, options)
    },
    goBack(workspaceId) {
      if (workspaceNavigationHistoryRestoreBlocked(workspaceId, 'back')) return
      const canonicalWorkspaceId = useWorkspacesStore.getState().workspaces[workspaceId]?.id
      if (!canonicalWorkspaceId) return
      const traversal = peekWorkspaceNavigation(canonicalWorkspaceId, 'back')
      if (!traversal) return
      restoreWorkspaceNavigationEntry(traversal.target, routeNavigation, {
        onCommit() {
          if (!commitWorkspaceNavigation(traversal)) {
            throw new Error('workspace navigation history changed before its route committed')
          }
        },
      })
    },
    goForward(workspaceId) {
      if (workspaceNavigationHistoryRestoreBlocked(workspaceId, 'forward')) return
      const canonicalWorkspaceId = useWorkspacesStore.getState().workspaces[workspaceId]?.id
      if (!canonicalWorkspaceId) return
      const traversal = peekWorkspaceNavigation(canonicalWorkspaceId, 'forward')
      if (!traversal) return
      restoreWorkspaceNavigationEntry(traversal.target, routeNavigation, {
        onCommit() {
          if (!commitWorkspaceNavigation(traversal)) {
            throw new Error('workspace navigation history changed before its route committed')
          }
        },
      })
    },
    openSettings(page) {
      const navigationIntent = beginPrimaryWindowNavigationIntent('user')
      routeNavigation.openSettings(page, { navigationIntent })
    },
    openCreateWorktree() {
      if (!currentWorkspaceId) return
      const navigationIntent = beginPrimaryWindowNavigationIntent('user')
      routeNavigation.openRepoNewWorktree(currentWorkspaceId, { navigationIntent })
    },
  }
}

function workspaceRootPanePresentationOptions(
  workspaceId: WorkspaceId,
  presentation: WorkspaceRootPanePresentation,
  options: PrimaryWindowNavigationOptions | undefined,
  navigationIntent: PrimaryWindowNavigationIntent,
): PrimaryWindowNavigationOptions {
  return {
    ...options,
    navigationIntent,
    onCommit: () => {
      const committed = commitPrimaryWindowNavigationEffect(
        () => commitFilesystemWorkspacePanePresentation({ kind: 'workspace-root', workspaceId }, presentation),
        options,
      )
      if (!committed) {
        throw new Error('workspace-root pane presentation target changed before route commit')
      }
    },
  }
}

function commitFilesystemWorkspacePanePresentation(
  target: FilesystemWorkspacePaneRouteTarget,
  presentation: WorkspaceRootPanePresentation,
): boolean {
  const state = useWorkspacesStore.getState()
  const workspaceId = target.workspaceId
  if (!state.workspaces[workspaceId]) return false
  if (presentation.kind === 'terminal') {
    state.setSelectedTerminal(
      formatTerminalFilesystemTargetKeyForPath(
        workspaceId,
        target.kind === 'workspace-root' ? workspaceId : target.worktreePath,
      ),
      presentation.terminalSessionId,
    )
  }
  state.setWorkspacePaneTabForTarget(target, presentation.kind === 'terminal' ? 'terminal' : presentation.tab)
  return true
}

async function commitFilesystemWorkspacePaneRoute(
  routeNavigation: PrimaryWindowRouteNavigation,
  target: FilesystemWorkspacePaneCommitTarget,
  route: WorkspacePaneRouteTarget,
  options?: PrimaryWindowNavigationOptions,
): Promise<boolean> {
  const ownsIntent = options?.navigationIntent === undefined
  const intent = resolvePrimaryWindowNavigationIntent(options)
  try {
    if (
      !intent.isCurrent() ||
      !filesystemWorkspacePaneCommitTargetIsCurrent(target, options?.onTargetPending, options?.presentationCurrentness)
    ) {
      options?.onAbandon?.()
      return false
    }
    const committed = await routeNavigation.commitFilesystemWorkspacePaneRoute(target.routeTarget, route, {
      replace: options?.replace,
      navigationIntent: intent,
      routePrecondition: options?.routePrecondition,
      onCommit: () => {
        commitPrimaryWindowNavigationEffect(() => {
          // History is already committed. Currentness now scopes only the
          // local supplement; it must not redefine the navigation outcome.
          if (filesystemWorkspacePaneCommitTargetIsCurrent(target, undefined, options?.presentationCurrentness)) {
            if (route === null) commitFilesystemWorkspacePaneEmptyPresentation(target.routeTarget)
            else commitFilesystemWorkspacePanePresentation(target.routeTarget, route)
          }
          return true
        }, options)
      },
      onAbandon: options?.onAbandon,
    })
    return committed
  } finally {
    if (ownsIntent) intent.release()
  }
}

function filesystemWorkspacePaneCommitTargetIsCurrent(
  target: FilesystemWorkspacePaneCommitTarget,
  onTargetPending?: () => void,
  presentationCurrentness?: () => WorkspacePaneTargetCurrentness,
): boolean {
  const targetCurrentness = filesystemWorkspacePaneTargetLeaseCurrentness(target)
  const presentation = presentationCurrentness?.() ?? 'current'
  const currentness =
    targetCurrentness === 'stale' || presentation === 'stale'
      ? 'stale'
      : targetCurrentness === 'pending' || presentation === 'pending'
        ? 'pending'
        : 'current'
  if (currentness === 'pending') onTargetPending?.()
  return currentness === 'current'
}

function commitFilesystemWorkspacePaneEmptyPresentation(target: FilesystemWorkspacePaneRouteTarget): boolean {
  const state = useWorkspacesStore.getState()
  if (!state.workspaces[target.workspaceId]) return false
  state.setWorkspacePaneTabForTarget(target, null)
  return true
}

async function commitWorkspacePaneRoute(
  routeNavigation: PrimaryWindowRouteNavigation,
  workspaceId: WorkspaceId,
  branchName: string,
  route: WorkspacePaneRouteTarget,
  options?: PrimaryWindowNavigationOptions,
): Promise<boolean> {
  const ownsIntent = options?.navigationIntent === undefined
  const intent = resolvePrimaryWindowNavigationIntent(options)
  try {
    if (!intent.isCurrent()) {
      options?.onAbandon?.()
      return false
    }
    const routeOptions = {
      replace: options?.replace,
      navigationIntent: intent,
      onCommit: options?.onCommit,
      onAbandon: options?.onAbandon,
      routePrecondition: options?.routePrecondition,
    }
    return await routeNavigation.commitWorkspacePaneRoute(workspaceId, branchName, route, routeOptions)
  } finally {
    if (ownsIntent) intent.release()
  }
}

function resolvePrimaryWindowNavigationIntent(
  options: PrimaryWindowNavigationOptions | undefined,
): PrimaryWindowNavigationIntent {
  if (options?.navigationIntent) return options.navigationIntent
  return beginPrimaryWindowNavigationIntent('user')
}

function restoreWorkspacePresentationOrOpenDashboard(
  workspaceId: WorkspaceId,
  routeNavigation: PrimaryWindowRouteNavigation,
  navigationIntent: PrimaryWindowNavigationIntent,
  options: { onBlocked: 'stay' | 'dashboard' },
): void {
  const state = useWorkspacesStore.getState()
  const workspace = state.workspaces[workspaceId]
  const entry = state.navigationHistoryByWorkspace[workspaceId]?.current ?? null
  // Creating a worktree is a transient workflow, not a resumable workspace presentation.
  // A non-Git workspace may resume only capability-invariant presentations;
  // stale Git-scoped history must not prevent picker activation.
  const entryCanResume =
    entry &&
    entry.route.kind !== 'newWorktree' &&
    (workspace?.capability.kind === 'git' || entry.route.kind === 'workspace-root' || entry.route.kind === 'dashboard')
  if (entryCanResume) {
    const result = restoreWorkspaceNavigationEntry(entry, routeNavigation, { navigationIntent })
    if (result.kind === 'accepted') return
    if (result.kind === 'blocked' && options.onBlocked === 'stay') {
      navigationIntent.release()
      return
    }
  }
  const fallbackIntent = navigationIntent.isCurrent() ? navigationIntent : beginPrimaryWindowNavigationIntent('user')
  routeNavigation.openWorkspaceDashboard(workspaceId, { navigationIntent: fallbackIntent })
}

function nextWorkspaceIdAfterClose(workspaceOrder: WorkspaceId[], closingWorkspaceId: WorkspaceId): WorkspaceId | null {
  const currentIndex = workspaceOrder.findIndex((workspaceId) => workspaceId === closingWorkspaceId)
  if (currentIndex === -1) return workspaceOrder[0] ?? null
  return workspaceOrder[currentIndex + 1] ?? workspaceOrder[currentIndex - 1] ?? null
}

function nextNavigationWorkspaceId(
  workspaceOrder: WorkspaceId[],
  currentWorkspaceId: WorkspaceId | null,
  direction: 1 | -1,
): WorkspaceId | null {
  if (workspaceOrder.length === 0) return null
  if (!currentWorkspaceId) return workspaceOrder[0] ?? null
  const currentIndex = workspaceOrder.findIndex((workspaceId) => workspaceId === currentWorkspaceId)
  if (currentIndex === -1) return workspaceOrder[0] ?? null
  return workspaceOrder[(currentIndex + direction + workspaceOrder.length) % workspaceOrder.length] ?? null
}
