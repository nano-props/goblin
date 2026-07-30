import type { HistoryState } from '@tanstack/history'
import type { useRouter } from '@tanstack/react-router'
import type { ParsedWorkspacePaneRouteTarget, WorkspacePaneRouteTarget } from '#/web/App.tsx'
import type { AppRouteNavigationOptions, FilesystemWorkspacePaneRouteTarget } from '#/web/app-route-navigation.ts'
import {
  appNavigationIsCurrent,
  appNavigationState,
  type AppNavigationGeneration,
} from '#/web/app-navigation-lifecycle.ts'
import { appRoutePreconditionMatches, settleOwnedAppRouteCommit } from '#/web/app-route-commit.ts'
import { parsedWorkspacePaneRouteFromTargetHref } from '#/web/app-route-href.ts'
import { branchSlugFromName, worktreeSlugFromPath } from '#/web/workspace-route-slugs.ts'

type AppRouter = ReturnType<typeof useRouter>

export async function commitFilesystemWorkspacePaneRoute(input: {
  router: AppRouter
  workspaceSlug: string
  paneTarget: FilesystemWorkspacePaneRouteTarget
  route: WorkspacePaneRouteTarget
  options?: AppRouteNavigationOptions
}): Promise<boolean> {
  const { router, workspaceSlug, paneTarget, route, options } = input
  if (options?.navigationGeneration && !appNavigationIsCurrent(options.navigationGeneration)) {
    return abandonAppRouteCommit(options)
  }
  const worktreeParams =
    paneTarget.kind === 'git-worktree'
      ? { workspaceSlug, worktreeSlug: worktreeSlugFromPath(paneTarget.worktreePath) }
      : null
  const routeHref = (candidate: ParsedWorkspacePaneRouteTarget): string =>
    filesystemWorkspacePaneRouteHref(router, workspaceSlug, paneTarget, candidate)
  const rootHref = routeHref(null)
  const currentHref = router.state.location.href
  const expectedCurrentHref = expectedCurrentWorkspacePaneHref(
    currentHref,
    rootHref,
    options?.routePrecondition,
    routeHref,
  )
  if (expectedCurrentHref === null) return abandonAppRouteCommit(options)
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
      } else if (worktreeParams) {
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
    },
  })
}

export async function commitBranchWorkspacePaneRoute(input: {
  router: AppRouter
  workspaceSlug: string
  branchName: string
  route: WorkspacePaneRouteTarget
  options?: AppRouteNavigationOptions
}): Promise<boolean> {
  const { router, workspaceSlug, branchName, route, options } = input
  if (options?.navigationGeneration && !appNavigationIsCurrent(options.navigationGeneration)) {
    return abandonAppRouteCommit(options)
  }
  const branchSlug = branchSlugFromName(branchName)
  const currentHref = router.state.location.href
  const routeHref = (candidate: ParsedWorkspacePaneRouteTarget): string =>
    branchWorkspacePaneRouteHref(router, workspaceSlug, branchSlug, candidate)
  const branchRootHref = routeHref(null)
  const expectedCurrentHref = expectedCurrentWorkspacePaneHref(
    currentHref,
    branchRootHref,
    options?.routePrecondition,
    routeHref,
  )
  if (expectedCurrentHref === null) return abandonAppRouteCommit(options)
  const replace = options?.replace
  if (route === null) {
    const target = router.buildLocation({
      to: '/workspace/$workspaceSlug/branch/$branchSlug',
      params: { workspaceSlug, branchSlug },
    })
    return await settleBranchWorkspacePaneRouteNavigation({
      router,
      targetHref: target.href,
      expectedCurrentHref,
      options,
      navigate: async (navigationGeneration) => {
        await router.navigate({
          to: '/workspace/$workspaceSlug/branch/$branchSlug',
          params: { workspaceSlug, branchSlug },
          replace,
          ignoreBlocker: true,
          state: (state) => appNavigationState(state, navigationGeneration),
        })
      },
    })
  }
  if (route.kind === 'static') {
    const target = router.buildLocation({
      to: '/workspace/$workspaceSlug/branch/$branchSlug/tab/$tabKey',
      params: { workspaceSlug, branchSlug, tabKey: route.tab },
    })
    return await settleBranchWorkspacePaneRouteNavigation({
      router,
      targetHref: target.href,
      expectedCurrentHref,
      options,
      navigate: async (navigationGeneration) => {
        await router.navigate({
          to: '/workspace/$workspaceSlug/branch/$branchSlug/tab/$tabKey',
          params: { workspaceSlug, branchSlug, tabKey: route.tab },
          replace,
          ignoreBlocker: true,
          state: (state) => appNavigationState(state, navigationGeneration),
        })
      },
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
  return await settleBranchWorkspacePaneRouteNavigation({
    router,
    targetHref: target.href,
    expectedCurrentHref,
    options,
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
  })
}

async function settleBranchWorkspacePaneRouteNavigation(input: {
  router: AppRouter
  targetHref: string
  expectedCurrentHref: string | undefined
  options?: AppRouteNavigationOptions
  navigate: (navigationGeneration: AppNavigationGeneration) => Promise<void>
}): Promise<boolean> {
  const { router, targetHref, expectedCurrentHref, options } = input
  const currentHref = router.state.location.href
  if (currentHref === targetHref && appRoutePreconditionMatches(currentHref, expectedCurrentHref)) {
    options?.onCommit?.()
    return true
  }
  return await settleOwnedAppRouteCommit({
    generation: options?.navigationGeneration,
    commitEffect: options?.onCommit,
    abandonEffect: options?.onAbandon,
    targetHref,
    expectedCurrentHref,
    navigate: input.navigate,
    currentHref: () => router.state.location.href,
  })
}

function expectedCurrentWorkspacePaneHref(
  currentHref: string,
  rootHref: string,
  precondition: AppRouteNavigationOptions['routePrecondition'],
  routeHref: (route: ParsedWorkspacePaneRouteTarget) => string,
): string | null | undefined {
  if (!precondition) return undefined
  if (precondition.kind === 'exact-route') return routeHref(precondition.route)
  return parsedWorkspacePaneRouteFromTargetHref(currentHref, rootHref) !== undefined ? currentHref : null
}

function filesystemWorkspacePaneRouteHref(
  router: AppRouter,
  workspaceSlug: string,
  paneTarget: FilesystemWorkspacePaneRouteTarget,
  route: ParsedWorkspacePaneRouteTarget,
): string {
  if (paneTarget.kind === 'workspace-root') {
    if (route === null) {
      return router.buildLocation({
        to: '/workspace/$workspaceSlug/root',
        params: { workspaceSlug },
      }).href
    }
    if (route.kind === 'static' || route.kind === 'invalid-static') {
      return router.buildLocation({
        to: '/workspace/$workspaceSlug/root/tab/$tabKey',
        params: { workspaceSlug, tabKey: route.kind === 'static' ? route.tab : route.tabKey },
      }).href
    }
    return router.buildLocation({
      to: '/workspace/$workspaceSlug/root/terminal/$terminalSessionId',
      params: { workspaceSlug, terminalSessionId: route.terminalSessionId },
    }).href
  }

  const worktreeParams = {
    workspaceSlug,
    worktreeSlug: worktreeSlugFromPath(paneTarget.worktreePath),
  }
  if (route === null) {
    return router.buildLocation({
      to: '/workspace/$workspaceSlug/worktree/$worktreeSlug',
      params: worktreeParams,
    }).href
  }
  if (route.kind === 'static' || route.kind === 'invalid-static') {
    return router.buildLocation({
      to: '/workspace/$workspaceSlug/worktree/$worktreeSlug/tab/$tabKey',
      params: { ...worktreeParams, tabKey: route.kind === 'static' ? route.tab : route.tabKey },
    }).href
  }
  return router.buildLocation({
    to: '/workspace/$workspaceSlug/worktree/$worktreeSlug/terminal/$terminalSessionId',
    params: { ...worktreeParams, terminalSessionId: route.terminalSessionId },
  }).href
}

function branchWorkspacePaneRouteHref(
  router: AppRouter,
  workspaceSlug: string,
  branchSlug: string,
  route: ParsedWorkspacePaneRouteTarget,
): string {
  if (route === null) {
    return router.buildLocation({
      to: '/workspace/$workspaceSlug/branch/$branchSlug',
      params: { workspaceSlug, branchSlug },
    }).href
  }
  if (route.kind === 'static' || route.kind === 'invalid-static') {
    return router.buildLocation({
      to: '/workspace/$workspaceSlug/branch/$branchSlug/tab/$tabKey',
      params: {
        workspaceSlug,
        branchSlug,
        tabKey: route.kind === 'static' ? route.tab : route.tabKey,
      },
    }).href
  }
  return router.buildLocation({
    to: '/workspace/$workspaceSlug/branch/$branchSlug/terminal/$terminalSessionId',
    params: {
      workspaceSlug,
      branchSlug,
      terminalSessionId: route.terminalSessionId,
    },
  }).href
}

function abandonAppRouteCommit(options: AppRouteNavigationOptions | undefined): false {
  options?.onAbandon?.()
  return false
}
