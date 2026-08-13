import { useRouter } from 'vue-router'
import type { RouteLocationRaw, Router } from 'vue-router'
import type { SettingsPage } from '#/shared/settings-pages.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import type {
  FilesystemWorkspacePaneTabsTarget,
  GitBranchWorkspacePaneTabsTarget,
  GitWorktreeWorkspacePaneTabsTarget,
} from '#/shared/workspace-pane-tabs-target.ts'
import type {
  BranchWorkspacePaneRouteTarget,
  ParsedBranchWorkspacePaneRouteTarget,
  ParsedWorkspacePaneRouteTarget,
  WorkspacePaneRouteTarget,
} from '#/web/App.tsx'
import { appNavigationState } from '#/web/app-navigation-lifecycle.ts'
import type { AppNavigationExecutionOptions, AppNavigationGeneration } from '#/web/app-navigation-lifecycle.ts'
import { runOwnedAppNavigation } from '#/web/app-route-commit.ts'
import {
  branchWorkspacePaneRouteFromHref,
  returnToFromHref,
  routeReturnSearch,
  workspacePaneRouteFromTargetHref,
} from '#/web/app-route-href.ts'
import { appRouteHref, currentAppRouteHref, navigateAppRoute } from '#/web/app-router-location.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { getRepoSnapshotQueryData } from '#/web/repo-query-cache.ts'
import { repoWorktreeForBranch } from '#/shared/git-types.ts'
import {
  commitBranchWorkspacePaneRoute,
  commitFilesystemWorkspacePaneRoute,
} from '#/web/workspace-pane-route-commit.ts'
import { branchSlugFromName, workspaceSlugFromId, worktreeSlugFromPath } from '#/web/workspace-route-slugs.ts'

export interface AppRouteNavigationOptions<
  Route extends ParsedWorkspacePaneRouteTarget = ParsedWorkspacePaneRouteTarget,
> extends AppNavigationExecutionOptions {
  routePrecondition?: { kind: 'exact-route'; route: Route } | { kind: 'current-workspace-target' }
}

export type BranchAppRouteNavigationOptions = AppRouteNavigationOptions<ParsedBranchWorkspacePaneRouteTarget>

export interface RepoBranchWorkspacePaneRouteNavigation {
  openRepoBranch: (workspaceId: WorkspaceId, branchName: string, options?: BranchAppRouteNavigationOptions) => boolean
  openRepoBranchTab: (
    workspaceId: WorkspaceId,
    branchName: string,
    tab: WorkspacePaneStaticTabType,
    options?: BranchAppRouteNavigationOptions,
  ) => boolean
}

export interface RepoWorkspacePaneRouteNavigation extends RepoBranchWorkspacePaneRouteNavigation {
  openRepoWorktreeTerminal: (
    workspaceId: WorkspaceId,
    worktreePath: string,
    terminalSessionId: string,
    options?: AppRouteNavigationOptions,
  ) => boolean
}

export interface AppRouteNavigation extends RepoWorkspacePaneRouteNavigation {
  workspaceSlugForId: (workspaceId: WorkspaceId) => string | null
  currentWorkspacePaneRoute: (workspaceId: WorkspaceId, branchName: string) => WorkspacePaneRouteTarget | undefined
  openHome: (options?: AppRouteNavigationOptions) => void
  openSettings: (page: SettingsPage, options?: AppRouteNavigationOptions) => void
  closeSettings: (options?: AppRouteNavigationOptions) => void
  openWorkspaceNavigator: (workspaceId: WorkspaceId, options?: AppRouteNavigationOptions) => void
  openWorkspaceRootPane: (workspaceId: WorkspaceId, options?: AppRouteNavigationOptions) => boolean
  openWorkspaceRootTab: (
    workspaceId: WorkspaceId,
    tab: WorkspacePaneStaticTabType,
    options?: AppRouteNavigationOptions,
  ) => boolean
  openWorkspaceRootTerminal: (
    workspaceId: WorkspaceId,
    terminalSessionId: string,
    options?: AppRouteNavigationOptions,
  ) => boolean
  commitFilesystemWorkspacePaneRoute: (
    target: FilesystemWorkspacePaneTabsTarget,
    route: WorkspacePaneRouteTarget,
    options?: AppRouteNavigationOptions,
  ) => Promise<boolean>
  openWorkspaceDashboard: (workspaceId: WorkspaceId, options?: AppRouteNavigationOptions) => void
  openRepoWorktree: (workspaceId: WorkspaceId, worktreePath: string, options?: AppRouteNavigationOptions) => boolean
  openRepoWorktreeTab: (
    workspaceId: WorkspaceId,
    worktreePath: string,
    tab: WorkspacePaneStaticTabType,
    options?: AppRouteNavigationOptions,
  ) => boolean
  commitWorkspacePaneRoute: (
    workspaceId: WorkspaceId,
    branchName: string,
    route: BranchWorkspacePaneRouteTarget,
    options?: BranchAppRouteNavigationOptions,
  ) => Promise<boolean>
  openRepoNewWorktree: (
    workspaceId: WorkspaceId,
    options?: {
      returnTo?: string | null
      navigationGeneration?: AppNavigationGeneration
      onCommit?: () => void
      onAbandon?: () => void
    },
  ) => void
  cancelRepoNewWorktree: (workspaceId: WorkspaceId, options?: AppRouteNavigationOptions) => void
}

export function useAppRouteNavigation(): AppRouteNavigation {
  return createAppRouteNavigation(useRouter())
}

function createAppRouteNavigation(router: Router): AppRouteNavigation {
  const navigation: AppRouteNavigation = {
    workspaceSlugForId: workspaceSlugForKnownId,
    currentWorkspacePaneRoute(workspaceId, branchName) {
      const target = currentWorkspacePaneTargetForBranch(workspaceId, branchName)
      if (!target) return undefined
      const workspaceSlug = workspaceSlugForKnownId(workspaceId)
      if (!workspaceSlug) return undefined
      const targetRootHref = appRouteHref(
        router,
        target.kind === 'git-worktree'
          ? {
              name: 'workspace-worktree',
              params: { workspaceSlug, worktreeSlug: worktreeSlugFromPath(target.worktreePath) },
            }
          : {
              name: 'workspace-branch',
              params: { workspaceSlug, branchSlug: branchSlugFromName(target.branchName) },
            },
      )
      const currentHref = currentAppRouteHref(router)
      return target.kind === 'git-worktree'
        ? workspacePaneRouteFromTargetHref(currentHref, targetRootHref)
        : branchWorkspacePaneRouteFromHref(currentHref, targetRootHref)
    },
    openHome(options) {
      runRouteNavigation(router, { name: 'home' }, options)
    },
    openSettings(page, options) {
      const href = currentAppRouteHref(router)
      const query = routeReturnSearch(href, '/settings', '/settings')
      runRouteNavigation(router, { name: 'settings', params: { page }, query }, options)
    },
    closeSettings(options) {
      const href = returnToFromHref(currentAppRouteHref(router))
      if (href) runRouteNavigation(router, href, options)
      else navigation.openHome(options)
    },
    openWorkspaceNavigator(workspaceId, options) {
      const workspaceSlug = workspaceSlugForKnownId(workspaceId)
      if (!workspaceSlug) {
        options?.onAbandon?.()
        return
      }
      runRouteNavigation(router, { name: 'workspace', params: { workspaceSlug } }, options)
    },
    openWorkspaceDashboard(workspaceId, options) {
      const workspaceSlug = workspaceSlugForKnownId(workspaceId)
      if (!workspaceSlug) {
        options?.onAbandon?.()
        return
      }
      runRouteNavigation(router, { name: 'workspace-dashboard', params: { workspaceSlug } }, options)
    },
    openWorkspaceRootPane(workspaceId, options) {
      const workspaceSlug = workspaceSlugForKnownId(workspaceId)
      if (!workspaceSlug) return abandonAppRoute(options)
      return runRouteNavigation(router, { name: 'workspace-root', params: { workspaceSlug } }, options)
    },
    openWorkspaceRootTab(workspaceId, tab, options) {
      const workspaceSlug = workspaceSlugForKnownId(workspaceId)
      if (!workspaceSlug) return abandonAppRoute(options)
      return runRouteNavigation(router, { name: 'workspace-root-tab', params: { workspaceSlug, tabKey: tab } }, options)
    },
    openWorkspaceRootTerminal(workspaceId, terminalSessionId, options) {
      const workspaceSlug = workspaceSlugForKnownId(workspaceId)
      if (!workspaceSlug) return abandonAppRoute(options)
      return runRouteNavigation(
        router,
        { name: 'workspace-root-terminal', params: { workspaceSlug, terminalSessionId } },
        options,
      )
    },
    async commitFilesystemWorkspacePaneRoute(paneTarget, route, options) {
      const workspaceSlug = workspaceSlugForKnownId(paneTarget.workspaceId)
      if (!workspaceSlug) return abandonAppRoute(options)
      return await commitFilesystemWorkspacePaneRoute({ router, workspaceSlug, paneTarget, route, options })
    },
    openRepoBranch(workspaceId, branchName, options) {
      const target = currentWorkspacePaneTargetForBranch(workspaceId, branchName)
      if (!target) return abandonAppRoute(options)
      if (target.kind === 'git-worktree') return navigation.openRepoWorktree(workspaceId, target.worktreePath, options)
      const workspaceSlug = workspaceSlugForKnownId(workspaceId)
      if (!workspaceSlug) return abandonAppRoute(options)
      return runRouteNavigation(
        router,
        { name: 'workspace-branch', params: { workspaceSlug, branchSlug: branchSlugFromName(target.branchName) } },
        options,
      )
    },
    openRepoBranchTab(workspaceId, branchName, tab, options) {
      const target = currentWorkspacePaneTargetForBranch(workspaceId, branchName)
      if (!target) return abandonAppRoute(options)
      if (target.kind === 'git-worktree') {
        return navigation.openRepoWorktreeTab(workspaceId, target.worktreePath, tab, options)
      }
      const workspaceSlug = workspaceSlugForKnownId(workspaceId)
      if (!workspaceSlug) return abandonAppRoute(options)
      return runRouteNavigation(
        router,
        {
          name: 'workspace-branch-tab',
          params: { workspaceSlug, branchSlug: branchSlugFromName(target.branchName), tabKey: tab },
        },
        options,
      )
    },
    openRepoWorktree(workspaceId, worktreePath, options) {
      const workspaceSlug = workspaceSlugForKnownId(workspaceId)
      if (!workspaceSlug) return abandonAppRoute(options)
      return runRouteNavigation(
        router,
        { name: 'workspace-worktree', params: { workspaceSlug, worktreeSlug: worktreeSlugFromPath(worktreePath) } },
        options,
      )
    },
    openRepoWorktreeTerminal(workspaceId, worktreePath, terminalSessionId, options) {
      const workspaceSlug = workspaceSlugForKnownId(workspaceId)
      if (!workspaceSlug) return abandonAppRoute(options)
      return runRouteNavigation(
        router,
        {
          name: 'workspace-worktree-terminal',
          params: { workspaceSlug, worktreeSlug: worktreeSlugFromPath(worktreePath), terminalSessionId },
        },
        options,
      )
    },
    openRepoWorktreeTab(workspaceId, worktreePath, tab, options) {
      const workspaceSlug = workspaceSlugForKnownId(workspaceId)
      if (!workspaceSlug) return abandonAppRoute(options)
      return runRouteNavigation(
        router,
        {
          name: 'workspace-worktree-tab',
          params: { workspaceSlug, worktreeSlug: worktreeSlugFromPath(worktreePath), tabKey: tab },
        },
        options,
      )
    },
    async commitWorkspacePaneRoute(workspaceId, branchName, route, options) {
      const target = currentWorkspacePaneTargetForBranch(workspaceId, branchName)
      if (!target) return abandonAppRoute(options)
      if (target.kind === 'git-worktree') {
        return await navigation.commitFilesystemWorkspacePaneRoute(target, route, options)
      }
      const workspaceSlug = workspaceSlugForKnownId(workspaceId)
      if (!workspaceSlug) return abandonAppRoute(options)
      return await commitBranchWorkspacePaneRoute({
        router,
        workspaceSlug,
        branchName: target.branchName,
        route,
        options,
      })
    },
    openRepoNewWorktree(workspaceId, options) {
      const workspaceSlug = workspaceSlugForKnownId(workspaceId)
      if (!workspaceSlug) {
        options?.onAbandon?.()
        return
      }
      const href = currentAppRouteHref(router)
      const targetPath = `/workspace/${workspaceSlug}/worktree/new`
      const query =
        options?.returnTo === undefined
          ? routeReturnSearch(href, targetPath)
          : options.returnTo
            ? { returnTo: options.returnTo }
            : {}
      runRouteNavigation(router, { name: 'workspace-new-worktree', params: { workspaceSlug }, query }, options)
    },
    cancelRepoNewWorktree(workspaceId, options) {
      const href = returnToFromHref(currentAppRouteHref(router))
      if (href) {
        runRouteNavigation(router, href, options)
        return
      }
      navigation.openWorkspaceNavigator(workspaceId, options)
    },
  }
  return navigation
}

function runRouteNavigation(
  router: Router,
  target: RouteLocationRaw,
  options: AppRouteNavigationOptions | undefined,
): boolean {
  const targetHref = appRouteHref(router, target)
  return runOwnedAppNavigation({
    generation: options?.navigationGeneration,
    commitEffect: options?.onCommit,
    abandonEffect: options?.onAbandon,
    targetHref,
    currentHref: currentAppRouteHref(router),
    navigate: async (navigationGeneration) => {
      await navigateAppRoute(router, target, options?.replace ?? false, appNavigationState({}, navigationGeneration))
    },
  })
}

function abandonAppRoute(options: AppRouteNavigationOptions | undefined): false {
  options?.onAbandon?.()
  return false
}

function workspaceSlugForKnownId(workspaceId: WorkspaceId): string | null {
  const workspace = workspacesStore.getState().workspaces[workspaceId]
  return workspace ? workspaceSlugFromId(workspace.id) : null
}

function currentWorkspacePaneTargetForBranch(
  workspaceId: WorkspaceId,
  branchName: string,
): GitBranchWorkspacePaneTabsTarget | GitWorktreeWorkspacePaneTabsTarget | null {
  const workspace = workspacesStore.getState().workspaces[workspaceId]
  if (!workspace || workspace.capability.kind !== 'git') return null
  const snapshot = getRepoSnapshotQueryData(workspace.id, workspace.workspaceRuntimeId)
  if (!snapshot?.branches.some((branch) => branch.name === branchName)) return null
  const worktree = repoWorktreeForBranch(snapshot.worktrees, branchName)
  return worktree
    ? { kind: 'git-worktree', workspaceId, worktreePath: worktree.path }
    : { kind: 'git-branch', workspaceId, branchName }
}
