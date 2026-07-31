import { useRouter } from '@tanstack/react-router'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { useMemo } from 'react'
import { branchSlugFromName, workspaceSlugFromId, worktreeSlugFromPath } from '#/web/workspace-route-slugs.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import type { SettingsPage } from '#/shared/settings-pages.ts'
import type { WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import type { ParsedWorkspacePaneRouteTarget, WorkspacePaneRouteTarget } from '#/web/App.tsx'
import type { WorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import { appNavigationState, type AppNavigationGeneration } from '#/web/app-navigation-lifecycle.ts'
import { runOwnedAppNavigation } from '#/web/app-route-commit.ts'
import { returnToFromHref, routeReturnSearch, workspacePaneRouteFromBranchHref } from '#/web/app-route-href.ts'
import {
  commitBranchWorkspacePaneRoute,
  commitFilesystemWorkspacePaneRoute,
} from '#/web/workspace-pane-route-commit.ts'

export interface AppRouteNavigationOptions {
  replace?: boolean
  navigationGeneration?: AppNavigationGeneration
  onCommit?: () => void
  onAbandon?: () => void
  routePrecondition?:
    { kind: 'exact-route'; route: ParsedWorkspacePaneRouteTarget } | { kind: 'current-workspace-target' }
}

export type FilesystemWorkspacePaneRouteTarget = Extract<
  WorkspacePaneTabsTarget,
  { kind: 'workspace-root' | 'git-worktree' }
>

export interface RepoBranchWorkspacePaneRouteNavigation {
  openRepoBranch: (workspaceId: WorkspaceId, branchName: string, options?: AppRouteNavigationOptions) => boolean
  openRepoBranchTab: (
    workspaceId: WorkspaceId,
    branchName: string,
    tab: WorkspacePaneStaticTabType,
    options?: AppRouteNavigationOptions,
  ) => boolean
  openRepoBranchTerminal: (
    workspaceId: WorkspaceId,
    branchName: string,
    terminalSessionId: string,
    options?: AppRouteNavigationOptions,
  ) => boolean
}

export interface AppRouteNavigation extends RepoBranchWorkspacePaneRouteNavigation {
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
  /** Operation-owned filesystem-pane presentation that resolves only after the route commits or is abandoned. */
  commitFilesystemWorkspacePaneRoute: (
    target: FilesystemWorkspacePaneRouteTarget,
    route: WorkspacePaneRouteTarget,
    options?: AppRouteNavigationOptions,
  ) => Promise<boolean>
  openWorkspaceDashboard: (workspaceId: WorkspaceId, options?: AppRouteNavigationOptions) => void
  openRepoWorktree: (workspaceId: WorkspaceId, worktreePath: string, options?: AppRouteNavigationOptions) => boolean
  openRepoWorktreeTerminal: (
    workspaceId: WorkspaceId,
    worktreePath: string,
    terminalSessionId: string,
    options?: AppRouteNavigationOptions,
  ) => boolean
  openRepoWorktreeTab: (
    workspaceId: WorkspaceId,
    worktreePath: string,
    tab: WorkspacePaneStaticTabType,
    options?: AppRouteNavigationOptions,
  ) => boolean
  /** Operation-owned navigation that settles only after the requested route is the router's current location. */
  commitWorkspacePaneRoute: (
    workspaceId: WorkspaceId,
    branchName: string,
    route: WorkspacePaneRouteTarget,
    options?: AppRouteNavigationOptions,
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
  const router = useRouter({ warn: false })
  return useMemo(() => {
    return {
      workspaceSlugForId(workspaceId) {
        const workspace = useWorkspacesStore.getState().workspaces[workspaceId]
        return workspace ? workspaceSlugFromId(workspace.id) : null
      },
      currentWorkspacePaneRoute(workspaceId, branchName) {
        const workspaceSlug = workspaceSlugForId(workspaceId)
        if (!workspaceSlug) return undefined
        const branchRootHref = router.buildLocation({
          to: '/workspace/$workspaceSlug/branch/$branchSlug',
          params: { workspaceSlug, branchSlug: branchSlugFromName(branchName) },
        }).href
        return workspacePaneRouteFromBranchHref(router.state.location.href, branchRootHref)
      },
      openHome(options) {
        if (!router) return
        const target = router.buildLocation({ to: '/' })
        void runOwnedAppNavigation({
          generation: options?.navigationGeneration,
          commitEffect: options?.onCommit,
          abandonEffect: options?.onAbandon,
          targetHref: target.href,
          currentHref: router.state.location.href,
          navigate: async (navigationGeneration) => {
            await router.navigate({
              to: '/',
              state: (state) => appNavigationState(state, navigationGeneration),
            })
          },
        })
      },
      openSettings(page, options) {
        if (!router) return
        const href = router?.state.location.href ?? null
        const search = routeReturnSearch(href, '/settings', '/settings')
        const target = router.buildLocation({
          to: '/settings/$page',
          params: { page },
          search,
        })
        void runOwnedAppNavigation({
          generation: options?.navigationGeneration,
          commitEffect: options?.onCommit,
          abandonEffect: options?.onAbandon,
          targetHref: target.href,
          currentHref: router.state.location.href,
          navigate: async (navigationGeneration) => {
            await router.navigate({
              to: '/settings/$page',
              params: { page },
              search,
              state: (state) => appNavigationState(state, navigationGeneration),
            })
          },
        })
      },
      closeSettings(options) {
        const href = returnToFromHref(router?.state.location.href ?? null)
        if (href && router) {
          void runOwnedAppNavigation({
            generation: options?.navigationGeneration,
            commitEffect: options?.onCommit,
            abandonEffect: options?.onAbandon,
            targetHref: href,
            currentHref: router.state.location.href,
            navigate: async (navigationGeneration) => {
              router.history.push(href, appNavigationState(router.state.location.state, navigationGeneration))
            },
          })
        } else {
          this.openHome(options)
        }
      },
      openWorkspaceNavigator(workspaceId, options) {
        const workspaceSlug = workspaceSlugForId(workspaceId)
        if (!workspaceSlug || !router) {
          options?.onAbandon?.()
          return
        }
        const target = router.buildLocation({ to: '/workspace/$workspaceSlug', params: { workspaceSlug } })
        void runOwnedAppNavigation({
          generation: options?.navigationGeneration,
          commitEffect: options?.onCommit,
          abandonEffect: options?.onAbandon,
          targetHref: target.href,
          currentHref: router.state.location.href,
          navigate: async (navigationGeneration) => {
            await router.navigate({
              to: '/workspace/$workspaceSlug',
              params: { workspaceSlug },
              state: (state) => appNavigationState(state, navigationGeneration),
            })
          },
        })
      },
      openWorkspaceDashboard(workspaceId, options) {
        const workspaceSlug = workspaceSlugForId(workspaceId)
        if (!workspaceSlug || !router) {
          options?.onAbandon?.()
          return
        }
        const target = router.buildLocation({ to: '/workspace/$workspaceSlug/dashboard', params: { workspaceSlug } })
        void runOwnedAppNavigation({
          generation: options?.navigationGeneration,
          commitEffect: options?.onCommit,
          abandonEffect: options?.onAbandon,
          targetHref: target.href,
          currentHref: router.state.location.href,
          navigate: async (navigationGeneration) => {
            await router.navigate({
              to: '/workspace/$workspaceSlug/dashboard',
              params: { workspaceSlug },
              state: (state) => appNavigationState(state, navigationGeneration),
            })
          },
        })
      },
      openWorkspaceRootPane(workspaceId, options) {
        const workspaceSlug = workspaceSlugForId(workspaceId)
        if (!workspaceSlug || !router) return abandonAppRoute(options)
        const target = router.buildLocation({ to: '/workspace/$workspaceSlug/root', params: { workspaceSlug } })
        return runOwnedAppNavigation({
          generation: options?.navigationGeneration,
          commitEffect: options?.onCommit,
          abandonEffect: options?.onAbandon,
          targetHref: target.href,
          currentHref: router.state.location.href,
          navigate: async (navigationGeneration) => {
            await router.navigate({
              to: '/workspace/$workspaceSlug/root',
              params: { workspaceSlug },
              state: (state) => appNavigationState(state, navigationGeneration),
            })
          },
        })
      },
      openWorkspaceRootTab(workspaceId, tab, options) {
        const workspaceSlug = workspaceSlugForId(workspaceId)
        if (!workspaceSlug || !router) return abandonAppRoute(options)
        const params = { workspaceSlug, tabKey: tab }
        const target = router.buildLocation({ to: '/workspace/$workspaceSlug/root/tab/$tabKey', params })
        return runOwnedAppNavigation({
          generation: options?.navigationGeneration,
          commitEffect: options?.onCommit,
          abandonEffect: options?.onAbandon,
          targetHref: target.href,
          currentHref: router.state.location.href,
          navigate: async (navigationGeneration) => {
            await router.navigate({
              to: '/workspace/$workspaceSlug/root/tab/$tabKey',
              params,
              replace: options?.replace,
              state: (state) => appNavigationState(state, navigationGeneration),
            })
          },
        })
      },
      openWorkspaceRootTerminal(workspaceId, terminalSessionId, options) {
        const workspaceSlug = workspaceSlugForId(workspaceId)
        if (!workspaceSlug || !router) return abandonAppRoute(options)
        const params = { workspaceSlug, terminalSessionId }
        const target = router.buildLocation({
          to: '/workspace/$workspaceSlug/root/terminal/$terminalSessionId',
          params,
        })
        return runOwnedAppNavigation({
          generation: options?.navigationGeneration,
          commitEffect: options?.onCommit,
          abandonEffect: options?.onAbandon,
          targetHref: target.href,
          currentHref: router.state.location.href,
          navigate: async (navigationGeneration) => {
            await router.navigate({
              to: '/workspace/$workspaceSlug/root/terminal/$terminalSessionId',
              params,
              replace: options?.replace,
              state: (state) => appNavigationState(state, navigationGeneration),
            })
          },
        })
      },
      async commitFilesystemWorkspacePaneRoute(paneTarget, route, options) {
        const workspaceId = paneTarget.workspaceId
        const workspaceSlug = workspaceSlugForId(workspaceId)
        if (!workspaceSlug || !router) return abandonAppRoute(options)
        return await commitFilesystemWorkspacePaneRoute({
          router,
          workspaceSlug,
          paneTarget,
          route,
          options,
        })
      },
      openRepoBranch(workspaceId, branchName, options) {
        const workspaceSlug = workspaceSlugForId(workspaceId)
        if (!workspaceSlug || !router) return abandonAppRoute(options)
        const params = { workspaceSlug, branchSlug: branchSlugFromName(branchName) }
        const target = router.buildLocation({ to: '/workspace/$workspaceSlug/branch/$branchSlug', params })
        return runOwnedAppNavigation({
          generation: options?.navigationGeneration,
          commitEffect: options?.onCommit,
          abandonEffect: options?.onAbandon,
          targetHref: target.href,
          currentHref: router.state.location.href,
          navigate: async (navigationGeneration) => {
            await router.navigate({
              to: '/workspace/$workspaceSlug/branch/$branchSlug',
              params,
              replace: options?.replace,
              state: (state) => appNavigationState(state, navigationGeneration),
            })
          },
        })
      },
      openRepoBranchTab(workspaceId, branchName, tab, options) {
        const workspaceSlug = workspaceSlugForId(workspaceId)
        if (!workspaceSlug || !router) return abandonAppRoute(options)
        const params = { workspaceSlug, branchSlug: branchSlugFromName(branchName), tabKey: tab }
        const target = router.buildLocation({ to: '/workspace/$workspaceSlug/branch/$branchSlug/tab/$tabKey', params })
        return runOwnedAppNavigation({
          generation: options?.navigationGeneration,
          commitEffect: options?.onCommit,
          abandonEffect: options?.onAbandon,
          targetHref: target.href,
          currentHref: router.state.location.href,
          navigate: async (navigationGeneration) => {
            await router.navigate({
              to: '/workspace/$workspaceSlug/branch/$branchSlug/tab/$tabKey',
              params,
              replace: options?.replace,
              state: (state) => appNavigationState(state, navigationGeneration),
            })
          },
        })
      },
      openRepoBranchTerminal(workspaceId, branchName, terminalSessionId, options) {
        const workspaceSlug = workspaceSlugForId(workspaceId)
        if (!workspaceSlug || !router) return abandonAppRoute(options)
        const params = { workspaceSlug, branchSlug: branchSlugFromName(branchName), terminalSessionId }
        const target = router.buildLocation({
          to: '/workspace/$workspaceSlug/branch/$branchSlug/terminal/$terminalSessionId',
          params,
        })
        return runOwnedAppNavigation({
          generation: options?.navigationGeneration,
          commitEffect: options?.onCommit,
          abandonEffect: options?.onAbandon,
          targetHref: target.href,
          currentHref: router.state.location.href,
          navigate: async (navigationGeneration) => {
            await router.navigate({
              to: '/workspace/$workspaceSlug/branch/$branchSlug/terminal/$terminalSessionId',
              params,
              replace: options?.replace,
              state: (state) => appNavigationState(state, navigationGeneration),
            })
          },
        })
      },
      openRepoWorktree(workspaceId, worktreePath, options) {
        const workspaceSlug = workspaceSlugForId(workspaceId)
        if (!workspaceSlug || !router) return abandonAppRoute(options)
        const params = { workspaceSlug, worktreeSlug: worktreeSlugFromPath(worktreePath) }
        const target = router.buildLocation({ to: '/workspace/$workspaceSlug/worktree/$worktreeSlug', params })
        return runOwnedAppNavigation({
          generation: options?.navigationGeneration,
          commitEffect: options?.onCommit,
          abandonEffect: options?.onAbandon,
          targetHref: target.href,
          currentHref: router.state.location.href,
          navigate: async (navigationGeneration) => {
            await router.navigate({
              to: '/workspace/$workspaceSlug/worktree/$worktreeSlug',
              params,
              replace: options?.replace,
              state: (state) => appNavigationState(state, navigationGeneration),
            })
          },
        })
      },
      openRepoWorktreeTerminal(workspaceId, worktreePath, terminalSessionId, options) {
        const workspaceSlug = workspaceSlugForId(workspaceId)
        if (!workspaceSlug || !router) return abandonAppRoute(options)
        const params = { workspaceSlug, worktreeSlug: worktreeSlugFromPath(worktreePath), terminalSessionId }
        const target = router.buildLocation({
          to: '/workspace/$workspaceSlug/worktree/$worktreeSlug/terminal/$terminalSessionId',
          params,
        })
        return runOwnedAppNavigation({
          generation: options?.navigationGeneration,
          commitEffect: options?.onCommit,
          abandonEffect: options?.onAbandon,
          targetHref: target.href,
          currentHref: router.state.location.href,
          navigate: async (navigationGeneration) => {
            await router.navigate({
              to: '/workspace/$workspaceSlug/worktree/$worktreeSlug/terminal/$terminalSessionId',
              params,
              replace: options?.replace,
              state: (state) => appNavigationState(state, navigationGeneration),
            })
          },
        })
      },
      openRepoWorktreeTab(workspaceId, worktreePath, tab, options) {
        const workspaceSlug = workspaceSlugForId(workspaceId)
        if (!workspaceSlug || !router) return abandonAppRoute(options)
        const params = { workspaceSlug, worktreeSlug: worktreeSlugFromPath(worktreePath), tabKey: tab }
        const target = router.buildLocation({
          to: '/workspace/$workspaceSlug/worktree/$worktreeSlug/tab/$tabKey',
          params,
        })
        return runOwnedAppNavigation({
          generation: options?.navigationGeneration,
          commitEffect: options?.onCommit,
          abandonEffect: options?.onAbandon,
          targetHref: target.href,
          currentHref: router.state.location.href,
          navigate: async (navigationGeneration) => {
            await router.navigate({
              to: '/workspace/$workspaceSlug/worktree/$worktreeSlug/tab/$tabKey',
              params,
              replace: options?.replace,
              state: (state) => appNavigationState(state, navigationGeneration),
            })
          },
        })
      },
      async commitWorkspacePaneRoute(workspaceId, branchName, route, options) {
        const workspaceSlug = workspaceSlugForId(workspaceId)
        if (!workspaceSlug) return abandonAppRoute(options)
        return await commitBranchWorkspacePaneRoute({
          router,
          workspaceSlug,
          branchName,
          route,
          options,
        })
      },
      openRepoNewWorktree(workspaceId, options) {
        const workspaceSlug = workspaceSlugForId(workspaceId)
        const href = router?.state.location.href ?? null
        if (workspaceSlug && router) {
          const targetPath = `/workspace/${workspaceSlug}/worktree/new`
          let search: { returnTo?: string } = {}
          if (options?.returnTo === undefined) search = routeReturnSearch(href, targetPath)
          else if (options.returnTo) search = { returnTo: options.returnTo }
          const target = router.buildLocation({
            to: '/workspace/$workspaceSlug/worktree/new',
            params: { workspaceSlug },
            search,
          })
          void runOwnedAppNavigation({
            generation: options?.navigationGeneration,
            commitEffect: options?.onCommit,
            abandonEffect: options?.onAbandon,
            targetHref: target.href,
            currentHref: router.state.location.href,
            navigate: async (navigationGeneration) => {
              await router.navigate({
                to: '/workspace/$workspaceSlug/worktree/new',
                params: { workspaceSlug },
                search,
                state: (state) => appNavigationState(state, navigationGeneration),
              })
            },
          })
          return
        }
        options?.onAbandon?.()
      },
      cancelRepoNewWorktree(workspaceId, options) {
        const href = returnToFromHref(router?.state.location.href ?? null)
        if (href && router) {
          void runOwnedAppNavigation({
            generation: options?.navigationGeneration,
            commitEffect: options?.onCommit,
            abandonEffect: options?.onAbandon,
            targetHref: href,
            currentHref: router.state.location.href,
            navigate: async (navigationGeneration) => {
              router.history.push(href, appNavigationState(router.state.location.state, navigationGeneration))
            },
          })
        } else {
          const workspaceSlug = workspaceSlugForId(workspaceId)
          if (workspaceSlug) this.openWorkspaceNavigator(workspaceId, options)
        }
      },
    }
  }, [router])
}

/** Arbiter-aware facade for route-owning UI callbacks outside the primary navigation context. */
export function useAppRouteActions(): AppRouteNavigation {
  return useAppRouteNavigation()
}

function abandonAppRoute(options: AppRouteNavigationOptions | undefined): false {
  options?.onAbandon?.()
  return false
}

function workspaceSlugForId(workspaceId: WorkspaceId): string | null {
  const workspace = useWorkspacesStore.getState().workspaces[workspaceId]
  return workspace ? workspaceSlugFromId(workspace.id) : null
}
