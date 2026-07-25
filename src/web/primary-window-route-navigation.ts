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
  beginPrimaryWindowNavigationIntent,
  executePrimaryWindowNavigation,
  primaryWindowNavigationState,
  primaryWindowNavigationIsCurrent,
  type PrimaryWindowNavigationOutcome,
  type PrimaryWindowNavigationGeneration,
  type PrimaryWindowNavigationIntent,
} from '#/web/primary-window-navigation-lifecycle.ts'
import { navigationLog } from '#/web/logger.ts'

export interface PrimaryWindowRouteNavigationOptions {
  replace?: boolean
  navigationIntent?: PrimaryWindowNavigationIntent
  onCommit?: () => void
  onAbandon?: () => void
  routePrecondition?:
    { kind: 'exact-route'; route: ParsedWorkspacePaneRouteTarget } | { kind: 'current-workspace-target' }
}

export type FilesystemWorkspacePaneRouteTarget = Extract<
  WorkspacePaneTabsTarget,
  { kind: 'workspace-root' | 'git-worktree' }
>

export interface PrimaryWindowRouteNavigation {
  workspaceSlugForId: (workspaceId: WorkspaceId) => string | null
  currentWorkspacePaneRoute: (workspaceId: WorkspaceId, branchName: string) => WorkspacePaneRouteTarget | undefined
  openHome: (options?: PrimaryWindowRouteNavigationOptions) => void
  openSettings: (page: SettingsPage, options?: PrimaryWindowRouteNavigationOptions) => void
  closeSettings: (options?: PrimaryWindowRouteNavigationOptions) => void
  openWorkspaceNavigator: (workspaceId: WorkspaceId, options?: PrimaryWindowRouteNavigationOptions) => void
  openWorkspaceRootPane: (workspaceId: WorkspaceId, options?: PrimaryWindowRouteNavigationOptions) => boolean
  openWorkspaceRootTab: (
    workspaceId: WorkspaceId,
    tab: WorkspacePaneStaticTabType,
    options?: PrimaryWindowRouteNavigationOptions,
  ) => boolean
  openWorkspaceRootTerminal: (
    workspaceId: WorkspaceId,
    terminalSessionId: string,
    options?: PrimaryWindowRouteNavigationOptions,
  ) => boolean
  /** Operation-owned filesystem-pane presentation that resolves only after the route commits or is abandoned. */
  commitFilesystemWorkspacePaneRoute: (
    target: FilesystemWorkspacePaneRouteTarget,
    route: WorkspacePaneRouteTarget,
    options?: PrimaryWindowRouteNavigationOptions,
  ) => Promise<boolean>
  openWorkspaceDashboard: (workspaceId: WorkspaceId, options?: PrimaryWindowRouteNavigationOptions) => void
  openRepoBranch: (
    workspaceId: WorkspaceId,
    branchName: string,
    options?: PrimaryWindowRouteNavigationOptions,
  ) => boolean
  openRepoBranchTab: (
    workspaceId: WorkspaceId,
    branchName: string,
    tab: WorkspacePaneStaticTabType,
    options?: PrimaryWindowRouteNavigationOptions,
  ) => boolean
  openRepoBranchTerminal: (
    workspaceId: WorkspaceId,
    branchName: string,
    terminalSessionId: string,
    options?: PrimaryWindowRouteNavigationOptions,
  ) => boolean
  openRepoWorktree: (
    workspaceId: WorkspaceId,
    worktreePath: string,
    options?: PrimaryWindowRouteNavigationOptions,
  ) => boolean
  openRepoWorktreeTerminal: (
    workspaceId: WorkspaceId,
    worktreePath: string,
    terminalSessionId: string,
    options?: PrimaryWindowRouteNavigationOptions,
  ) => boolean
  openRepoWorktreeTab: (
    workspaceId: WorkspaceId,
    worktreePath: string,
    tab: WorkspacePaneStaticTabType,
    options?: PrimaryWindowRouteNavigationOptions,
  ) => boolean
  /** Operation-owned navigation that settles only after the requested route is the router's current location. */
  commitWorkspacePaneRoute: (
    workspaceId: WorkspaceId,
    branchName: string,
    route: WorkspacePaneRouteTarget,
    options?: PrimaryWindowRouteNavigationOptions,
  ) => Promise<boolean>
  openRepoNewWorktree: (
    workspaceId: WorkspaceId,
    options?: {
      returnTo?: string | null
      navigationIntent?: PrimaryWindowNavigationIntent
      onCommit?: () => void
      onAbandon?: () => void
    },
  ) => void
  cancelRepoNewWorktree: (workspaceId: WorkspaceId, options?: PrimaryWindowRouteNavigationOptions) => void
}

export function usePrimaryWindowRouteNavigation(): PrimaryWindowRouteNavigation {
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
        void runOwnedPrimaryWindowNavigation({
          intent: options?.navigationIntent,
          commitEffect: options?.onCommit,
          abandonEffect: options?.onAbandon,
          targetHref: target.href,
          currentHref: router.state.location.href,
          navigate: async (navigationGeneration) => {
            await router.navigate({
              to: '/',
              state: (state) => primaryWindowNavigationState(state, navigationGeneration),
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
        void runOwnedPrimaryWindowNavigation({
          intent: options?.navigationIntent,
          commitEffect: options?.onCommit,
          abandonEffect: options?.onAbandon,
          targetHref: target.href,
          currentHref: router.state.location.href,
          navigate: async (navigationGeneration) => {
            await router.navigate({
              to: '/settings/$page',
              params: { page },
              search,
              state: (state) => primaryWindowNavigationState(state, navigationGeneration),
            })
          },
        })
      },
      closeSettings(options) {
        const href = returnToFromHref(router?.state.location.href ?? null)
        if (href && router) {
          void runOwnedPrimaryWindowNavigation({
            intent: options?.navigationIntent,
            commitEffect: options?.onCommit,
            abandonEffect: options?.onAbandon,
            targetHref: href,
            currentHref: router.state.location.href,
            navigate: async (navigationGeneration) => {
              router.history.push(href, primaryWindowNavigationState(router.state.location.state, navigationGeneration))
            },
          })
        } else {
          this.openHome(options)
        }
      },
      openWorkspaceNavigator(workspaceId, options) {
        const workspaceSlug = workspaceSlugForId(workspaceId)
        if (!workspaceSlug || !router) {
          abandonPrimaryWindowRoute(options)
          return
        }
        const target = router.buildLocation({ to: '/workspace/$workspaceSlug', params: { workspaceSlug } })
        void runOwnedPrimaryWindowNavigation({
          intent: options?.navigationIntent,
          commitEffect: options?.onCommit,
          abandonEffect: options?.onAbandon,
          targetHref: target.href,
          currentHref: router.state.location.href,
          navigate: async (navigationGeneration) => {
            await router.navigate({
              to: '/workspace/$workspaceSlug',
              params: { workspaceSlug },
              state: (state) => primaryWindowNavigationState(state, navigationGeneration),
            })
          },
        })
      },
      openWorkspaceDashboard(workspaceId, options) {
        const workspaceSlug = workspaceSlugForId(workspaceId)
        if (!workspaceSlug || !router) {
          abandonPrimaryWindowRoute(options)
          return
        }
        const target = router.buildLocation({ to: '/workspace/$workspaceSlug/dashboard', params: { workspaceSlug } })
        void runOwnedPrimaryWindowNavigation({
          intent: options?.navigationIntent,
          commitEffect: options?.onCommit,
          abandonEffect: options?.onAbandon,
          targetHref: target.href,
          currentHref: router.state.location.href,
          navigate: async (navigationGeneration) => {
            await router.navigate({
              to: '/workspace/$workspaceSlug/dashboard',
              params: { workspaceSlug },
              state: (state) => primaryWindowNavigationState(state, navigationGeneration),
            })
          },
        })
      },
      openWorkspaceRootPane(workspaceId, options) {
        const workspaceSlug = workspaceSlugForId(workspaceId)
        if (!workspaceSlug || !router) return abandonPrimaryWindowRoute(options)
        const target = router.buildLocation({ to: '/workspace/$workspaceSlug/root', params: { workspaceSlug } })
        return runOwnedPrimaryWindowNavigation({
          intent: options?.navigationIntent,
          commitEffect: options?.onCommit,
          abandonEffect: options?.onAbandon,
          targetHref: target.href,
          currentHref: router.state.location.href,
          navigate: async (navigationGeneration) => {
            await router.navigate({
              to: '/workspace/$workspaceSlug/root',
              params: { workspaceSlug },
              state: (state) => primaryWindowNavigationState(state, navigationGeneration),
            })
          },
        })
      },
      openWorkspaceRootTab(workspaceId, tab, options) {
        const workspaceSlug = workspaceSlugForId(workspaceId)
        if (!workspaceSlug || !router) return abandonPrimaryWindowRoute(options)
        const params = { workspaceSlug, tabKey: tab }
        const target = router.buildLocation({ to: '/workspace/$workspaceSlug/root/tab/$tabKey', params })
        return runOwnedPrimaryWindowNavigation({
          intent: options?.navigationIntent,
          commitEffect: options?.onCommit,
          abandonEffect: options?.onAbandon,
          targetHref: target.href,
          currentHref: router.state.location.href,
          navigate: async (navigationGeneration) => {
            await router.navigate({
              to: '/workspace/$workspaceSlug/root/tab/$tabKey',
              params,
              replace: options?.replace,
              state: (state) => primaryWindowNavigationState(state, navigationGeneration),
            })
          },
        })
      },
      openWorkspaceRootTerminal(workspaceId, terminalSessionId, options) {
        const workspaceSlug = workspaceSlugForId(workspaceId)
        if (!workspaceSlug || !router) return abandonPrimaryWindowRoute(options)
        const params = { workspaceSlug, terminalSessionId }
        const target = router.buildLocation({
          to: '/workspace/$workspaceSlug/root/terminal/$terminalSessionId',
          params,
        })
        return runOwnedPrimaryWindowNavigation({
          intent: options?.navigationIntent,
          commitEffect: options?.onCommit,
          abandonEffect: options?.onAbandon,
          targetHref: target.href,
          currentHref: router.state.location.href,
          navigate: async (navigationGeneration) => {
            await router.navigate({
              to: '/workspace/$workspaceSlug/root/terminal/$terminalSessionId',
              params,
              replace: options?.replace,
              state: (state) => primaryWindowNavigationState(state, navigationGeneration),
            })
          },
        })
      },
      async commitFilesystemWorkspacePaneRoute(paneTarget, route, options) {
        const workspaceId = paneTarget.workspaceId
        const workspaceSlug = workspaceSlugForId(workspaceId)
        if (!workspaceSlug || !router) return abandonPrimaryWindowRoute(options)
        if (options?.navigationIntent && !options.navigationIntent.isCurrent()) {
          return abandonPrimaryWindowRoute(options)
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
        if (expectedCurrentHref === null) return abandonPrimaryWindowRoute(options)
        const targetHref = routeHref(route)
        return await settleOwnedPrimaryWindowRouteCommit({
          intent: options?.navigationIntent,
          targetHref,
          expectedCurrentHref,
          commitEffect: options?.onCommit,
          abandonEffect: options?.onAbandon,
          currentHref: () => router.state.location.href,
          navigate: async (navigationGeneration) => {
            const navigationState = (state: HistoryState) => primaryWindowNavigationState(state, navigationGeneration)
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
        if (!workspaceSlug || !router) return abandonPrimaryWindowRoute(options)
        const params = { workspaceSlug, branchSlug: branchSlugFromName(branchName) }
        const target = router.buildLocation({ to: '/workspace/$workspaceSlug/branch/$branchSlug', params })
        return runOwnedPrimaryWindowNavigation({
          intent: options?.navigationIntent,
          commitEffect: options?.onCommit,
          abandonEffect: options?.onAbandon,
          targetHref: target.href,
          currentHref: router.state.location.href,
          navigate: async (navigationGeneration) => {
            await router.navigate({
              to: '/workspace/$workspaceSlug/branch/$branchSlug',
              params,
              replace: options?.replace,
              state: (state) => primaryWindowNavigationState(state, navigationGeneration),
            })
          },
        })
      },
      openRepoBranchTab(workspaceId, branchName, tab, options) {
        const workspaceSlug = workspaceSlugForId(workspaceId)
        if (!workspaceSlug || !router) return abandonPrimaryWindowRoute(options)
        const params = { workspaceSlug, branchSlug: branchSlugFromName(branchName), tabKey: tab }
        const target = router.buildLocation({ to: '/workspace/$workspaceSlug/branch/$branchSlug/tab/$tabKey', params })
        return runOwnedPrimaryWindowNavigation({
          intent: options?.navigationIntent,
          commitEffect: options?.onCommit,
          abandonEffect: options?.onAbandon,
          targetHref: target.href,
          currentHref: router.state.location.href,
          navigate: async (navigationGeneration) => {
            await router.navigate({
              to: '/workspace/$workspaceSlug/branch/$branchSlug/tab/$tabKey',
              params,
              replace: options?.replace,
              state: (state) => primaryWindowNavigationState(state, navigationGeneration),
            })
          },
        })
      },
      openRepoBranchTerminal(workspaceId, branchName, terminalSessionId, options) {
        const workspaceSlug = workspaceSlugForId(workspaceId)
        if (!workspaceSlug || !router) return abandonPrimaryWindowRoute(options)
        const params = { workspaceSlug, branchSlug: branchSlugFromName(branchName), terminalSessionId }
        const target = router.buildLocation({
          to: '/workspace/$workspaceSlug/branch/$branchSlug/terminal/$terminalSessionId',
          params,
        })
        return runOwnedPrimaryWindowNavigation({
          intent: options?.navigationIntent,
          commitEffect: options?.onCommit,
          abandonEffect: options?.onAbandon,
          targetHref: target.href,
          currentHref: router.state.location.href,
          navigate: async (navigationGeneration) => {
            await router.navigate({
              to: '/workspace/$workspaceSlug/branch/$branchSlug/terminal/$terminalSessionId',
              params,
              replace: options?.replace,
              state: (state) => primaryWindowNavigationState(state, navigationGeneration),
            })
          },
        })
      },
      openRepoWorktree(workspaceId, worktreePath, options) {
        const workspaceSlug = workspaceSlugForId(workspaceId)
        if (!workspaceSlug || !router) return abandonPrimaryWindowRoute(options)
        const params = { workspaceSlug, worktreeSlug: worktreeSlugFromPath(worktreePath) }
        const target = router.buildLocation({ to: '/workspace/$workspaceSlug/worktree/$worktreeSlug', params })
        return runOwnedPrimaryWindowNavigation({
          intent: options?.navigationIntent,
          commitEffect: options?.onCommit,
          abandonEffect: options?.onAbandon,
          targetHref: target.href,
          currentHref: router.state.location.href,
          navigate: async (navigationGeneration) => {
            await router.navigate({
              to: '/workspace/$workspaceSlug/worktree/$worktreeSlug',
              params,
              replace: options?.replace,
              state: (state) => primaryWindowNavigationState(state, navigationGeneration),
            })
          },
        })
      },
      openRepoWorktreeTerminal(workspaceId, worktreePath, terminalSessionId, options) {
        const workspaceSlug = workspaceSlugForId(workspaceId)
        if (!workspaceSlug || !router) return abandonPrimaryWindowRoute(options)
        const params = { workspaceSlug, worktreeSlug: worktreeSlugFromPath(worktreePath), terminalSessionId }
        const target = router.buildLocation({
          to: '/workspace/$workspaceSlug/worktree/$worktreeSlug/terminal/$terminalSessionId',
          params,
        })
        return runOwnedPrimaryWindowNavigation({
          intent: options?.navigationIntent,
          commitEffect: options?.onCommit,
          abandonEffect: options?.onAbandon,
          targetHref: target.href,
          currentHref: router.state.location.href,
          navigate: async (navigationGeneration) => {
            await router.navigate({
              to: '/workspace/$workspaceSlug/worktree/$worktreeSlug/terminal/$terminalSessionId',
              params,
              replace: options?.replace,
              state: (state) => primaryWindowNavigationState(state, navigationGeneration),
            })
          },
        })
      },
      openRepoWorktreeTab(workspaceId, worktreePath, tab, options) {
        const workspaceSlug = workspaceSlugForId(workspaceId)
        if (!workspaceSlug || !router) return abandonPrimaryWindowRoute(options)
        const params = { workspaceSlug, worktreeSlug: worktreeSlugFromPath(worktreePath), tabKey: tab }
        const target = router.buildLocation({
          to: '/workspace/$workspaceSlug/worktree/$worktreeSlug/tab/$tabKey',
          params,
        })
        return runOwnedPrimaryWindowNavigation({
          intent: options?.navigationIntent,
          commitEffect: options?.onCommit,
          abandonEffect: options?.onAbandon,
          targetHref: target.href,
          currentHref: router.state.location.href,
          navigate: async (navigationGeneration) => {
            await router.navigate({
              to: '/workspace/$workspaceSlug/worktree/$worktreeSlug/tab/$tabKey',
              params,
              replace: options?.replace,
              state: (state) => primaryWindowNavigationState(state, navigationGeneration),
            })
          },
        })
      },
      async commitWorkspacePaneRoute(workspaceId, branchName, route, options) {
        const workspaceSlug = workspaceSlugForId(workspaceId)
        if (!workspaceSlug) return abandonPrimaryWindowRoute(options)
        if (options?.navigationIntent && !options.navigationIntent.isCurrent()) {
          return abandonPrimaryWindowRoute(options)
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
        if (expectedCurrentHref === null) return abandonPrimaryWindowRoute(options)
        const replace = options?.replace
        if (route === null) {
          const target = router.buildLocation({
            to: '/workspace/$workspaceSlug/branch/$branchSlug',
            params: { workspaceSlug, branchSlug },
          })
          return await settleOwnedPrimaryWindowRouteCommit({
            intent: options?.navigationIntent,
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
                state: (state) => primaryWindowNavigationState(state, navigationGeneration),
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
          return await settleOwnedPrimaryWindowRouteCommit({
            intent: options?.navigationIntent,
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
                state: (state) => primaryWindowNavigationState(state, navigationGeneration),
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
        return await settleOwnedPrimaryWindowRouteCommit({
          intent: options?.navigationIntent,
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
              state: (state) => primaryWindowNavigationState(state, navigationGeneration),
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
          void runOwnedPrimaryWindowNavigation({
            intent: options?.navigationIntent,
            commitEffect: options?.onCommit,
            abandonEffect: options?.onAbandon,
            targetHref: target.href,
            currentHref: router.state.location.href,
            navigate: async (navigationGeneration) => {
              await router.navigate({
                to: '/workspace/$workspaceSlug/worktree/new',
                params: { workspaceSlug },
                search,
                state: (state) => primaryWindowNavigationState(state, navigationGeneration),
              })
            },
          })
          return
        }
        abandonPrimaryWindowRoute(options)
      },
      cancelRepoNewWorktree(workspaceId, options) {
        const href = returnToFromHref(router?.state.location.href ?? null)
        if (href && router) {
          void runOwnedPrimaryWindowNavigation({
            intent: options?.navigationIntent,
            commitEffect: options?.onCommit,
            abandonEffect: options?.onAbandon,
            targetHref: href,
            currentHref: router.state.location.href,
            navigate: async (navigationGeneration) => {
              router.history.push(href, primaryWindowNavigationState(router.state.location.state, navigationGeneration))
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
export function usePrimaryWindowRouteActions(): PrimaryWindowRouteNavigation {
  return usePrimaryWindowRouteNavigation()
}

export function runOwnedPrimaryWindowNavigation(input: {
  intent?: PrimaryWindowNavigationIntent
  targetHref: string
  currentHref: string
  commitEffect?: () => void
  abandonEffect?: () => void
  navigate(navigationGeneration: PrimaryWindowNavigationGeneration): Promise<unknown>
}): boolean {
  const intent = resolvePrimaryWindowNavigationIntent(input.intent)
  const generation = intent.generation
  if (input.currentHref === input.targetHref) {
    if (!intent.isCurrent()) {
      input.abandonEffect?.()
      return false
    }
    const committed = intent.commit(input.commitEffect)
    const outcome = intent.outcome()
    if (!committed && outcome?.status === 'failed') {
      navigationLog.error('primary-window navigation effect failed', {
        intendedStatus: outcome.intendedStatus,
        error: outcome.error,
      })
    }
    return committed
  }
  const registration = intent.register(input.targetHref, input.commitEffect, input.abandonEffect)
  if (!registration) {
    input.abandonEffect?.()
    return false
  }
  void registration.settled.then((outcome) => {
    if (outcome.status === 'failed') {
      navigationLog.error('primary-window navigation effect failed', {
        intendedStatus: outcome.intendedStatus,
        error: outcome.error,
      })
    }
  })
  void Promise.resolve()
    .then(async () => await executePrimaryWindowNavigation(generation, async () => await input.navigate(generation)))
    .then(() => registration.release())
    .catch((error: unknown) => {
      registration.fail(error)
      navigationLog.error('primary-window navigation failed', { error })
    })
  return true
}

type PrimaryWindowNavigationExecutionOutcome =
  { kind: 'completed'; executed: boolean; routeCommitted: boolean } | { kind: 'failed'; error: unknown }

export async function settleOwnedPrimaryWindowRouteCommit(input: {
  intent?: PrimaryWindowNavigationIntent
  targetHref: string
  expectedCurrentHref?: string
  commitEffect?: () => void
  abandonEffect?: () => void
  navigate(navigationGeneration: PrimaryWindowNavigationGeneration): Promise<void>
  currentHref(): string
}): Promise<boolean> {
  const intent = resolvePrimaryWindowNavigationIntent(input.intent)
  const generation = intent.generation
  const currentHref = input.currentHref()
  if (!primaryWindowRoutePreconditionMatches(currentHref, input.expectedCurrentHref)) {
    settleAdmittedPrimaryWindowRouteAbandon(intent, input.abandonEffect)
    return false
  }
  if (currentHref === input.targetHref) {
    if (!intent.isCurrent()) {
      input.abandonEffect?.()
      return false
    }
    intent.commit(input.commitEffect)
    const outcome = intent.outcome()
    return outcome ? committedPrimaryWindowNavigationOutcome(outcome) : false
  }
  const registration = intent.register(input.targetHref, input.commitEffect, input.abandonEffect)
  if (!registration) {
    input.abandonEffect?.()
    return false
  }
  let routeCommitted = false
  const execution: Promise<PrimaryWindowNavigationExecutionOutcome> = executePrimaryWindowNavigation(
    generation,
    async () => {
      routeCommitted = await settlePrimaryWindowRouteCommit({
        targetHref: input.targetHref,
        expectedCurrentHref: input.expectedCurrentHref,
        navigate: async () => await input.navigate(generation),
        currentHref: input.currentHref,
      })
    },
  ).then(
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
        navigationLog.error('settled primary-window navigation later failed', { error: outcome.error })
      }
    })
    return committedPrimaryWindowNavigationOutcome(first.settlement)
  }
  if (first.kind === 'failed') {
    registration.fail(first.error)
    throw first.error
  }
  registration.release()
  return first.executed && first.routeCommitted && committedPrimaryWindowNavigationOutcome(await registration.settled)
}

function resolvePrimaryWindowNavigationIntent(
  intent: PrimaryWindowNavigationIntent | undefined,
): PrimaryWindowNavigationIntent {
  if (intent) return intent
  return beginPrimaryWindowNavigationIntent('user')
}

function committedPrimaryWindowNavigationOutcome(outcome: PrimaryWindowNavigationOutcome): boolean {
  if (outcome.status === 'failed') throw outcome.error
  return outcome.status === 'committed'
}

function abandonPrimaryWindowRoute(options: PrimaryWindowRouteNavigationOptions | undefined): false {
  const intent = options?.navigationIntent
  if (intent?.isCurrent()) settleAdmittedPrimaryWindowRouteAbandon(intent, options?.onAbandon)
  else options?.onAbandon?.()
  return false
}

function settleAdmittedPrimaryWindowRouteAbandon(
  intent: PrimaryWindowNavigationIntent,
  abandonEffect: (() => void) | undefined,
): void {
  intent.abandonAdmission(abandonEffect)
  const outcome = intent.outcome()
  if (outcome?.status === 'failed') throw outcome.error
}

export async function settlePrimaryWindowRouteCommit(input: {
  targetHref: string
  expectedCurrentHref?: string
  navigate: () => Promise<void>
  currentHref: () => string
}): Promise<boolean> {
  if (!primaryWindowRoutePreconditionMatches(input.currentHref(), input.expectedCurrentHref)) return false
  await input.navigate()
  return input.currentHref() === input.targetHref
}

export function primaryWindowRoutePreconditionMatches(
  currentHref: string,
  expectedCurrentHref: string | undefined,
): boolean {
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
