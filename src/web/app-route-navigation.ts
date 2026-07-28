import { useRouter } from '@tanstack/react-router'
import type { HistoryState } from '@tanstack/history'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { useMemo } from 'react'
import { branchSlugFromName, workspaceSlugFromId, worktreeSlugFromPath } from '#/web/workspace-route-slugs.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import type { SettingsPage } from '#/shared/settings-pages.ts'
import { isWorkspacePaneStaticTabType, type WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import type { ParsedWorkspacePaneRouteTarget, WorkspacePaneRouteTarget } from '#/web/App.tsx'
import type { WorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import {
  beginAppNavigation,
  executeAppNavigation,
  appNavigationState,
  appNavigationIsCurrent,
  registerAppNavigation,
  type AppNavigationOutcome,
  type AppNavigationGeneration,
} from '#/web/app-navigation-lifecycle.ts'
import { navigationLog } from '#/web/logger.ts'

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

export interface AppRouteNavigation {
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
        if (options?.navigationGeneration && !appNavigationIsCurrent(options.navigationGeneration)) {
          return abandonAppRoute(options)
        }
        const worktreeParams =
          paneTarget.kind === 'git-worktree'
            ? { workspaceSlug, worktreeSlug: worktreeSlugFromPath(paneTarget.worktreePath) }
            : null
        const rootHref = worktreeParams
          ? router.buildLocation({
              to: '/workspace/$workspaceSlug/worktree/$worktreeSlug',
              params: worktreeParams,
            }).href
          : router.buildLocation({
              to: '/workspace/$workspaceSlug/root',
              params: { workspaceSlug },
            }).href
        const routeHref = (candidate: ParsedWorkspacePaneRouteTarget): string => {
          if (candidate === null) return rootHref
          if (candidate.kind === 'static' || candidate.kind === 'invalid-static') {
            const tabKey = candidate.kind === 'static' ? candidate.tab : candidate.tabKey
            return worktreeParams
              ? router.buildLocation({
                  to: '/workspace/$workspaceSlug/worktree/$worktreeSlug/tab/$tabKey',
                  params: { ...worktreeParams, tabKey },
                }).href
              : router.buildLocation({
                  to: '/workspace/$workspaceSlug/root/tab/$tabKey',
                  params: { workspaceSlug, tabKey },
                }).href
          }
          return worktreeParams
            ? router.buildLocation({
                to: '/workspace/$workspaceSlug/worktree/$worktreeSlug/terminal/$terminalSessionId',
                params: { ...worktreeParams, terminalSessionId: candidate.terminalSessionId },
              }).href
            : router.buildLocation({
                to: '/workspace/$workspaceSlug/root/terminal/$terminalSessionId',
                params: { workspaceSlug, terminalSessionId: candidate.terminalSessionId },
              }).href
        }
        const currentHref = router.state.location.href
        const routePrecondition = options?.routePrecondition
        const expectedCurrentHref =
          routePrecondition?.kind === 'current-workspace-target'
            ? parsedWorkspacePaneRouteFromTargetHref(currentHref, rootHref) !== undefined
              ? currentHref
              : null
            : routePrecondition?.kind === 'exact-route'
              ? routeHref(routePrecondition.route)
              : undefined
        if (expectedCurrentHref === null) return abandonAppRoute(options)
        const targetHref = routeHref(route)
        return await settleOwnedAppRouteCommit({
          generation: options?.navigationGeneration,
          targetHref,
          expectedCurrentHref,
          commitEffect: options?.onCommit,
          abandonEffect: options?.onAbandon,
          currentHref: () => router.state.location.href,
          navigate: async (navigationGeneration) => {
            const navigationState = (state: HistoryState) => appNavigationState(state, navigationGeneration)
            if (route === null) {
              if (worktreeParams) {
                await router.navigate({
                  to: '/workspace/$workspaceSlug/worktree/$worktreeSlug',
                  params: worktreeParams,
                  replace: options?.replace,
                  ignoreBlocker: true,
                  state: navigationState,
                })
              } else {
                await router.navigate({
                  to: '/workspace/$workspaceSlug/root',
                  params: { workspaceSlug },
                  replace: options?.replace,
                  ignoreBlocker: true,
                  state: navigationState,
                })
              }
            } else if (route.kind === 'static') {
              if (worktreeParams) {
                await router.navigate({
                  to: '/workspace/$workspaceSlug/worktree/$worktreeSlug/tab/$tabKey',
                  params: { ...worktreeParams, tabKey: route.tab },
                  replace: options?.replace,
                  ignoreBlocker: true,
                  state: navigationState,
                })
              } else {
                await router.navigate({
                  to: '/workspace/$workspaceSlug/root/tab/$tabKey',
                  params: { workspaceSlug, tabKey: route.tab },
                  replace: options?.replace,
                  ignoreBlocker: true,
                  state: navigationState,
                })
              }
            } else {
              if (worktreeParams) {
                await router.navigate({
                  to: '/workspace/$workspaceSlug/worktree/$worktreeSlug/terminal/$terminalSessionId',
                  params: { ...worktreeParams, terminalSessionId: route.terminalSessionId },
                  replace: options?.replace,
                  ignoreBlocker: true,
                  state: navigationState,
                })
              } else {
                await router.navigate({
                  to: '/workspace/$workspaceSlug/root/terminal/$terminalSessionId',
                  params: { workspaceSlug, terminalSessionId: route.terminalSessionId },
                  replace: options?.replace,
                  ignoreBlocker: true,
                  state: navigationState,
                })
              }
            }
          },
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
        if (options?.navigationGeneration && !appNavigationIsCurrent(options.navigationGeneration)) {
          return abandonAppRoute(options)
        }
        const branchSlug = branchSlugFromName(branchName)
        const routePrecondition = options?.routePrecondition
        const currentHref = router.state.location.href
        const branchRootHref = router.buildLocation({
          to: '/workspace/$workspaceSlug/branch/$branchSlug',
          params: { workspaceSlug, branchSlug },
        }).href
        const expectedCurrentHref =
          routePrecondition?.kind === 'current-workspace-target'
            ? parsedWorkspacePaneRouteFromTargetHref(currentHref, branchRootHref) !== undefined
              ? currentHref
              : null
            : routePrecondition === undefined
              ? undefined
              : (routePrecondition.route === null
                  ? router.buildLocation({
                      to: '/workspace/$workspaceSlug/branch/$branchSlug',
                      params: { workspaceSlug, branchSlug },
                    })
                  : routePrecondition.route.kind === 'static' || routePrecondition.route.kind === 'invalid-static'
                    ? router.buildLocation({
                        to: '/workspace/$workspaceSlug/branch/$branchSlug/tab/$tabKey',
                        params: {
                          workspaceSlug,
                          branchSlug,
                          tabKey:
                            routePrecondition.route.kind === 'static'
                              ? routePrecondition.route.tab
                              : routePrecondition.route.tabKey,
                        },
                      })
                    : router.buildLocation({
                        to: '/workspace/$workspaceSlug/branch/$branchSlug/terminal/$terminalSessionId',
                        params: {
                          workspaceSlug,
                          branchSlug,
                          terminalSessionId: routePrecondition.route.terminalSessionId,
                        },
                      })
                ).href
        if (expectedCurrentHref === null) return abandonAppRoute(options)
        const replace = options?.replace
        if (route === null) {
          const target = router.buildLocation({
            to: '/workspace/$workspaceSlug/branch/$branchSlug',
            params: { workspaceSlug, branchSlug },
          })
          if (
            router.state.location.href === target.href &&
            appRoutePreconditionMatches(router.state.location.href, expectedCurrentHref)
          ) {
            options?.onCommit?.()
            return true
          }
          return await settleOwnedAppRouteCommit({
            generation: options?.navigationGeneration,
            commitEffect: options?.onCommit,
            abandonEffect: options?.onAbandon,
            targetHref: target.href,
            expectedCurrentHref,
            navigate: async (navigationGeneration) => {
              await router.navigate({
                to: '/workspace/$workspaceSlug/branch/$branchSlug',
                params: { workspaceSlug, branchSlug },
                replace,
                ignoreBlocker: true,
                state: (state) => appNavigationState(state, navigationGeneration),
              })
            },
            currentHref: () => router.state.location.href,
          })
        }
        if (route.kind === 'static') {
          const target = router.buildLocation({
            to: '/workspace/$workspaceSlug/branch/$branchSlug/tab/$tabKey',
            params: { workspaceSlug, branchSlug, tabKey: route.tab },
          })
          if (
            router.state.location.href === target.href &&
            appRoutePreconditionMatches(router.state.location.href, expectedCurrentHref)
          ) {
            options?.onCommit?.()
            return true
          }
          return await settleOwnedAppRouteCommit({
            generation: options?.navigationGeneration,
            commitEffect: options?.onCommit,
            abandonEffect: options?.onAbandon,
            targetHref: target.href,
            expectedCurrentHref,
            navigate: async (navigationGeneration) => {
              await router.navigate({
                to: '/workspace/$workspaceSlug/branch/$branchSlug/tab/$tabKey',
                params: { workspaceSlug, branchSlug, tabKey: route.tab },
                replace,
                ignoreBlocker: true,
                state: (state) => appNavigationState(state, navigationGeneration),
              })
            },
            currentHref: () => router.state.location.href,
          })
        }
        const target = router.buildLocation({
          to: '/workspace/$workspaceSlug/branch/$branchSlug/terminal/$terminalSessionId',
          params: {
            workspaceSlug,
            branchSlug,
            terminalSessionId: route.terminalSessionId,
          },
        })
        if (
          router.state.location.href === target.href &&
          appRoutePreconditionMatches(router.state.location.href, expectedCurrentHref)
        ) {
          options?.onCommit?.()
          return true
        }
        return await settleOwnedAppRouteCommit({
          generation: options?.navigationGeneration,
          commitEffect: options?.onCommit,
          abandonEffect: options?.onAbandon,
          targetHref: target.href,
          expectedCurrentHref,
          navigate: async (navigationGeneration) => {
            await router.navigate({
              to: '/workspace/$workspaceSlug/branch/$branchSlug/terminal/$terminalSessionId',
              params: {
                workspaceSlug,
                branchSlug,
                terminalSessionId: route.terminalSessionId,
              },
              replace,
              ignoreBlocker: true,
              state: (state) => appNavigationState(state, navigationGeneration),
            })
          },
          currentHref: () => router.state.location.href,
        })
      },
      openRepoNewWorktree(workspaceId, options) {
        const workspaceSlug = workspaceSlugForId(workspaceId)
        const href = router?.state.location.href ?? null
        if (workspaceSlug && router) {
          const targetPath = `/workspace/${workspaceSlug}/worktree/new`
          const search =
            options?.returnTo === undefined
              ? routeReturnSearch(href, targetPath)
              : options.returnTo
                ? { returnTo: options.returnTo }
                : {}
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

export function runOwnedAppNavigation(input: {
  generation?: AppNavigationGeneration
  targetHref: string
  currentHref: string
  commitEffect?: () => void
  abandonEffect?: () => void
  navigate(navigationGeneration: AppNavigationGeneration): Promise<unknown>
}): boolean {
  const generation = input.generation ?? beginAppNavigation()
  if (input.currentHref === input.targetHref) {
    if (!appNavigationIsCurrent(generation)) {
      input.abandonEffect?.()
      return false
    }
    input.commitEffect?.()
    return true
  }
  const registration = registerAppNavigation(generation, input.targetHref, input.commitEffect, input.abandonEffect)
  if (!registration) {
    input.abandonEffect?.()
    return false
  }
  void registration.settled.then((outcome) => {
    if (outcome.status === 'failed') {
      navigationLog.error('app navigation effect failed', {
        intendedStatus: outcome.intendedStatus,
        error: outcome.error,
      })
    }
  })
  void Promise.resolve()
    .then(async () => await executeAppNavigation(generation, async () => await input.navigate(generation)))
    .finally(() => registration.release())
    .catch((error: unknown) => navigationLog.error('app navigation failed', { error }))
  return true
}

type AppNavigationExecutionOutcome =
  { kind: 'completed'; executed: boolean; routeCommitted: boolean } | { kind: 'failed'; error: unknown }

export async function settleOwnedAppRouteCommit(input: {
  generation?: AppNavigationGeneration
  targetHref: string
  expectedCurrentHref?: string
  commitEffect?: () => void
  abandonEffect?: () => void
  navigate(navigationGeneration: AppNavigationGeneration): Promise<void>
  currentHref(): string
}): Promise<boolean> {
  const generation = input.generation ?? beginAppNavigation()
  const currentHref = input.currentHref()
  if (!appRoutePreconditionMatches(currentHref, input.expectedCurrentHref)) {
    input.abandonEffect?.()
    return false
  }
  if (currentHref === input.targetHref) {
    if (!appNavigationIsCurrent(generation)) {
      input.abandonEffect?.()
      return false
    }
    input.commitEffect?.()
    return true
  }
  const registration = registerAppNavigation(generation, input.targetHref, input.commitEffect, input.abandonEffect)
  if (!registration) {
    input.abandonEffect?.()
    return false
  }
  let routeCommitted = false
  const execution: Promise<AppNavigationExecutionOutcome> = executeAppNavigation(generation, async () => {
    routeCommitted = await settleAppRouteCommit({
      targetHref: input.targetHref,
      expectedCurrentHref: input.expectedCurrentHref,
      navigate: async () => await input.navigate(generation),
      currentHref: input.currentHref,
    })
  }).then(
    (executed) => ({ kind: 'completed', executed, routeCommitted }),
    (error: unknown) => ({ kind: 'failed', error }),
  )
  const first = await Promise.race([
    execution,
    registration.settled.then((settlement) => ({ kind: 'settled' as const, settlement })),
  ])
  if (first.kind === 'settled') {
    void execution.then((outcome) => {
      registration.release()
      if (outcome.kind === 'failed') {
        navigationLog.error('settled app navigation later failed', { error: outcome.error })
      }
    })
    return committedAppNavigationOutcome(first.settlement)
  }
  registration.release()
  if (first.kind === 'failed') throw first.error
  return first.executed && first.routeCommitted && committedAppNavigationOutcome(await registration.settled)
}

function committedAppNavigationOutcome(outcome: AppNavigationOutcome): boolean {
  if (outcome.status === 'failed') throw outcome.error
  return outcome.status === 'committed'
}

function abandonAppRoute(options: AppRouteNavigationOptions | undefined): false {
  options?.onAbandon?.()
  return false
}

export async function settleAppRouteCommit(input: {
  targetHref: string
  expectedCurrentHref?: string
  navigate: () => Promise<void>
  currentHref: () => string
}): Promise<boolean> {
  if (!appRoutePreconditionMatches(input.currentHref(), input.expectedCurrentHref)) return false
  await input.navigate()
  return input.currentHref() === input.targetHref
}

export function appRoutePreconditionMatches(currentHref: string, expectedCurrentHref: string | undefined): boolean {
  return expectedCurrentHref === undefined || currentHref === expectedCurrentHref
}

export function workspacePaneRouteFromBranchHref(
  currentHref: string,
  branchRootHref: string,
): WorkspacePaneRouteTarget | undefined {
  const route = parsedWorkspacePaneRouteFromTargetHref(currentHref, branchRootHref)
  return route?.kind === 'invalid-static' ? undefined : route
}

export function parsedWorkspacePaneRouteFromTargetHref(
  currentHref: string,
  targetRootHref: string,
): ParsedWorkspacePaneRouteTarget | undefined {
  const currentPath = pathFromHref(currentHref)
  const targetRootPath = pathFromHref(targetRootHref)
  if (!currentPath || !targetRootPath) return undefined
  if (currentPath === targetRootPath) return null
  const prefix = `${targetRootPath}/`
  if (!currentPath.startsWith(prefix)) return undefined
  const [kind, encodedValue, ...rest] = currentPath.slice(prefix.length).split('/')
  if (!encodedValue || rest.length > 0) return undefined
  let value: string
  try {
    value = decodeURIComponent(encodedValue)
  } catch {
    return undefined
  }
  if (kind === 'tab') {
    return isWorkspacePaneStaticTabType(value)
      ? { kind: 'static', tab: value }
      : { kind: 'invalid-static', tabKey: value }
  }
  if (kind === 'terminal') return { kind: 'terminal', terminalSessionId: value }
  return undefined
}

function workspaceSlugForId(workspaceId: WorkspaceId): string | null {
  const workspace = useWorkspacesStore.getState().workspaces[workspaceId]
  return workspace ? workspaceSlugFromId(workspace.id) : null
}

export function routeReturnSearch(
  href: string | null,
  targetPath: string,
  currentRouteFamily = targetPath,
): { returnTo?: string } {
  if (!href) return {}
  const path = pathFromHref(href)
  if (!path) return {}
  if (path === targetPath || path.startsWith(currentRouteFamily)) {
    const existingReturnTo = returnToFromHref(href)
    return existingReturnTo ? { returnTo: existingReturnTo } : {}
  }
  return { returnTo: href }
}

export function returnToFromHref(href: string | null): string | null {
  if (!href) return null
  const queryStart = href.indexOf('?')
  if (queryStart < 0) return null
  const hashStart = href.indexOf('#', queryStart)
  const search = href.slice(queryStart + 1, hashStart < 0 ? undefined : hashStart)
  const returnTo = new URLSearchParams(search).get('returnTo')
  return isAppRelativeHref(returnTo) ? returnTo : null
}

function isAppRelativeHref(href: string | null): href is string {
  return !!href && href.startsWith('/') && !href.startsWith('//')
}

function pathFromHref(href: string): string | null {
  const queryStart = href.indexOf('?')
  const hashStart = href.indexOf('#')
  const end = queryStart >= 0 ? queryStart : hashStart >= 0 ? hashStart : href.length
  const path = href.slice(0, end)
  return path.startsWith('/') ? path : null
}
