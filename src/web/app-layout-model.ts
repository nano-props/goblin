import { isWorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import type { AppRouteNavigation } from '#/web/app-route-navigation.ts'
import { returnToFromHref } from '#/web/app-route-href.ts'
import type { AuthenticatedAppBootstrapState } from '#/web/hooks/useAuthenticatedAppBootstrap.ts'
import type { WorkspaceNavigationRouteContext } from '#/web/workspace-navigation-history.ts'
import { branchNameFromSlug, workspaceIdFromSlug, worktreePathFromSlug } from '#/web/workspace-route-slugs.ts'

export type AuthenticatedAppShellMode = 'settings' | 'workspace-restore' | 'workspace-failed' | 'workspace-ready'

export type WorkspaceRouteContext =
  | { kind: 'empty' | 'dashboard' | 'newWorktree'; workspaceSlug: string }
  | { kind: 'workspace-root'; workspaceSlug: string; workspacePaneRoute: ParsedWorkspacePaneRoute | null }
  | { kind: 'branch'; workspaceSlug: string; branchName: string; workspacePaneRoute: ParsedWorkspacePaneRoute | null }
  | {
      kind: 'worktree'
      workspaceSlug: string
      worktreePath: string
      workspacePaneRoute: ParsedWorkspacePaneRoute | null
    }

interface AppLayoutRouteActions {
  openSettings: AppRouteNavigation['openSettings']
  openHome: AppRouteNavigation['openHome']
}

export function appLayoutRouteCallbacks(routeActions: AppLayoutRouteActions) {
  return {
    navigateToSettingsShortcuts: () => routeActions.openSettings('shortcuts'),
    navigateToIndex: () => routeActions.openHome(),
  }
}

export function authenticatedAppShellMode(
  pathname: string,
  bootstrapState: AuthenticatedAppBootstrapState,
): AuthenticatedAppShellMode {
  if (pathname.startsWith('/settings')) return 'settings'
  if (bootstrapState.status === 'restoring-workspace') return 'workspace-restore'
  return bootstrapState.status === 'failed' ? 'workspace-failed' : 'workspace-ready'
}

export function currentWorkspacePaneRouteFromContext(
  routeContext: WorkspaceRouteContext | null,
): ParsedWorkspacePaneRoute | null {
  return routeContext && 'workspacePaneRoute' in routeContext ? routeContext.workspacePaneRoute : null
}

export function workspaceRouteContextFromMatches(
  matches: Array<{ routeId: string; params: Record<string, string> }>,
): WorkspaceRouteContext | null {
  const workspaceMatch = [...matches].reverse().find((match) => typeof match.params.workspaceSlug === 'string')
  if (!workspaceMatch) return null

  const workspaceSlug = workspaceMatch.params.workspaceSlug
  if (!workspaceSlug) return null

  const branchSlug = workspaceMatch.params.branchSlug
  if (branchSlug) {
    const branchName = branchNameFromSlug(branchSlug)
    return branchName
      ? {
          kind: 'branch',
          workspaceSlug,
          branchName,
          workspacePaneRoute: workspacePaneRouteFromMatches(matches),
        }
      : { kind: 'empty', workspaceSlug }
  }

  const worktreeSlug = workspaceMatch.params.worktreeSlug
  if (worktreeSlug) {
    const worktreePath = worktreePathFromSlug(worktreeSlug)
    return worktreePath
      ? { kind: 'worktree', workspaceSlug, worktreePath, workspacePaneRoute: workspacePaneRouteFromMatches(matches) }
      : { kind: 'empty', workspaceSlug }
  }

  if (workspaceMatch.routeId.includes('/worktree/new')) return { kind: 'newWorktree', workspaceSlug }
  if (workspaceMatch.routeId.includes('/dashboard')) return { kind: 'dashboard', workspaceSlug }
  if (workspaceMatch.routeId.includes('/root')) {
    return { kind: 'workspace-root', workspaceSlug, workspacePaneRoute: workspacePaneRouteFromMatches(matches) }
  }
  return { kind: 'empty', workspaceSlug }
}

export function workspaceNavigationRouteContext(
  routeContext: WorkspaceRouteContext | null,
  routeHref: string | null,
): WorkspaceNavigationRouteContext | null {
  if (!routeContext) return null
  const workspaceId = workspaceIdFromSlug(routeContext.workspaceSlug)
  if (!workspaceId) return null
  if (routeContext.kind === 'branch' || routeContext.kind === 'workspace-root' || routeContext.kind === 'worktree') {
    return null
  }
  if (routeContext.kind === 'newWorktree') {
    return { kind: 'newWorktree', workspaceId, returnTo: returnToFromHref(routeHref) }
  }
  return { kind: routeContext.kind, workspaceId }
}

function workspacePaneRouteFromMatches(
  matches: Array<{ routeId: string; params: Record<string, string> }>,
): ParsedWorkspacePaneRoute | null {
  const terminalMatch = [...matches].reverse().find((match) => typeof match.params.terminalSessionId === 'string')
  const terminalSessionId = terminalMatch?.params.terminalSessionId
  if (terminalSessionId) return { kind: 'terminal', terminalSessionId }

  const tabMatch = [...matches].reverse().find((match) => typeof match.params.tabKey === 'string')
  const tabKey = tabMatch?.params.tabKey
  if (!tabKey) return null
  return isWorkspacePaneStaticTabType(tabKey) ? { kind: 'static', tab: tabKey } : { kind: 'invalid-static', tabKey }
}
