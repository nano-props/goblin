import { useRouter } from '@tanstack/react-router'
import { useMemo } from 'react'
import { branchSlugFromName, repoSlugFromId } from '#/web/repo-route-slugs.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { SettingsPage } from '#/shared/settings-pages.ts'
import type { WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import type { RepoBranchWorkspacePaneRouteTarget } from '#/web/App.tsx'
import {
  beginPrimaryWindowPresentation,
  primaryWindowNavigationState,
  registerPrimaryWindowNavigation,
  releasePrimaryWindowNavigation,
  type PrimaryWindowPresentationToken,
} from '#/web/primary-window-presentation.ts'

export interface PrimaryWindowRouteNavigationOptions {
  replace?: boolean
  presentationToken?: PrimaryWindowPresentationToken
  onCommit?: () => void
  routePrecondition?:
    { kind: 'exact-route'; route: RepoBranchWorkspacePaneRouteTarget } | { kind: 'current-workspace-target' }
}

export interface PrimaryWindowRouteNavigation {
  repoSlugForId: (repoId: string) => string | null
  openHome: (options?: PrimaryWindowRouteNavigationOptions) => void
  openSettings: (page: SettingsPage, options?: PrimaryWindowRouteNavigationOptions) => void
  closeSettings: (options?: PrimaryWindowRouteNavigationOptions) => void
  openRepoRoot: (repoId: string, options?: PrimaryWindowRouteNavigationOptions) => void
  openRepoDashboard: (repoId: string, options?: PrimaryWindowRouteNavigationOptions) => void
  openRepoBranch: (repoId: string, branchName: string, options?: PrimaryWindowRouteNavigationOptions) => boolean
  openRepoBranchTab: (
    repoId: string,
    branchName: string,
    tab: WorkspacePaneStaticTabType,
    options?: PrimaryWindowRouteNavigationOptions,
  ) => boolean
  openRepoBranchTerminal: (
    repoId: string,
    branchName: string,
    terminalSessionId: string,
    options?: PrimaryWindowRouteNavigationOptions,
  ) => boolean
  /** Operation-owned navigation that settles only after the requested route is the router's current location. */
  commitRepoBranchWorkspacePaneRoute?: (
    repoId: string,
    branchName: string,
    route: RepoBranchWorkspacePaneRouteTarget,
    options?: PrimaryWindowRouteNavigationOptions,
  ) => Promise<boolean>
  openRepoNewWorktree: (
    repoId: string,
    options?: {
      returnTo?: string | null
      presentationToken?: PrimaryWindowPresentationToken
      onCommit?: () => void
    },
  ) => void
  cancelRepoNewWorktree: (repoId: string, options?: PrimaryWindowRouteNavigationOptions) => void
}

export function usePrimaryWindowRouteNavigation(): PrimaryWindowRouteNavigation {
  const router = useRouter({ warn: false })
  return useMemo(() => {
    return {
      repoSlugForId(repoId) {
        const repo = useReposStore.getState().repos[repoId]
        return repo ? repoSlugFromId(repo.id) : null
      },
      openHome(options) {
        if (!router) return
        const target = router.buildLocation({ to: '/' })
        void runOwnedPrimaryWindowNavigation({
          token: options?.presentationToken,
          commitEffect: options?.onCommit,
          targetHref: target.href,
          navigate: async (navigationId) => {
            await router.navigate({
              to: '/',
              state: (state) => primaryWindowNavigationState(state, navigationId),
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
          token: options?.presentationToken,
          commitEffect: options?.onCommit,
          targetHref: target.href,
          navigate: async (navigationId) => {
            await router.navigate({
              to: '/settings/$page',
              params: { page },
              search,
              state: (state) => primaryWindowNavigationState(state, navigationId),
            })
          },
        })
      },
      closeSettings(options) {
        const href = returnToFromHref(router?.state.location.href ?? null)
        if (href && router) {
          void runOwnedPrimaryWindowNavigation({
            token: options?.presentationToken,
            commitEffect: options?.onCommit,
            targetHref: href,
            navigate: async (navigationId) => {
              router.history.push(href, primaryWindowNavigationState(router.state.location.state, navigationId))
            },
          })
        } else {
          this.openHome(options)
        }
      },
      openRepoRoot(repoId, options) {
        const repoSlug = repoSlugForId(repoId)
        if (!repoSlug || !router) return
        const target = router.buildLocation({ to: '/repo/$repoSlug', params: { repoSlug } })
        void runOwnedPrimaryWindowNavigation({
          token: options?.presentationToken,
          commitEffect: options?.onCommit,
          targetHref: target.href,
          navigate: async (navigationId) => {
            await router.navigate({
              to: '/repo/$repoSlug',
              params: { repoSlug },
              state: (state) => primaryWindowNavigationState(state, navigationId),
            })
          },
        })
      },
      openRepoDashboard(repoId, options) {
        const repoSlug = repoSlugForId(repoId)
        if (!repoSlug || !router) return
        const target = router.buildLocation({ to: '/repo/$repoSlug/dashboard', params: { repoSlug } })
        void runOwnedPrimaryWindowNavigation({
          token: options?.presentationToken,
          commitEffect: options?.onCommit,
          targetHref: target.href,
          navigate: async (navigationId) => {
            await router.navigate({
              to: '/repo/$repoSlug/dashboard',
              params: { repoSlug },
              state: (state) => primaryWindowNavigationState(state, navigationId),
            })
          },
        })
      },
      openRepoBranch(repoId, branchName, options) {
        const repoSlug = repoSlugForId(repoId)
        if (!repoSlug || !router) return false
        const params = { repoSlug, branchSlug: branchSlugFromName(branchName) }
        const target = router.buildLocation({ to: '/repo/$repoSlug/branch/$branchSlug', params })
        return runOwnedPrimaryWindowNavigation({
          token: options?.presentationToken,
          commitEffect: options?.onCommit,
          targetHref: target.href,
          navigate: async (navigationId) => {
            await router.navigate({
              to: '/repo/$repoSlug/branch/$branchSlug',
              params,
              replace: options?.replace,
              state: (state) => primaryWindowNavigationState(state, navigationId),
            })
          },
        })
      },
      openRepoBranchTab(repoId, branchName, tab, options) {
        const repoSlug = repoSlugForId(repoId)
        if (!repoSlug || !router) return false
        const params = { repoSlug, branchSlug: branchSlugFromName(branchName), tabKey: tab }
        const target = router.buildLocation({ to: '/repo/$repoSlug/branch/$branchSlug/tab/$tabKey', params })
        return runOwnedPrimaryWindowNavigation({
          token: options?.presentationToken,
          commitEffect: options?.onCommit,
          targetHref: target.href,
          navigate: async (navigationId) => {
            await router.navigate({
              to: '/repo/$repoSlug/branch/$branchSlug/tab/$tabKey',
              params,
              replace: options?.replace,
              state: (state) => primaryWindowNavigationState(state, navigationId),
            })
          },
        })
      },
      openRepoBranchTerminal(repoId, branchName, terminalSessionId, options) {
        const repoSlug = repoSlugForId(repoId)
        if (!repoSlug || !router) return false
        const params = { repoSlug, branchSlug: branchSlugFromName(branchName), terminalSessionId }
        const target = router.buildLocation({
          to: '/repo/$repoSlug/branch/$branchSlug/terminal/$terminalSessionId',
          params,
        })
        return runOwnedPrimaryWindowNavigation({
          token: options?.presentationToken,
          commitEffect: options?.onCommit,
          targetHref: target.href,
          navigate: async (navigationId) => {
            await router.navigate({
              to: '/repo/$repoSlug/branch/$branchSlug/terminal/$terminalSessionId',
              params,
              replace: options?.replace,
              state: (state) => primaryWindowNavigationState(state, navigationId),
            })
          },
        })
      },
      async commitRepoBranchWorkspacePaneRoute(repoId, branchName, route, options) {
        const repoSlug = repoSlugForId(repoId)
        if (!repoSlug) return false
        const branchSlug = branchSlugFromName(branchName)
        const routePrecondition = options?.routePrecondition
        const currentHref = router.state.location.href
        const branchRootHref = router.buildLocation({
          to: '/repo/$repoSlug/branch/$branchSlug',
          params: { repoSlug, branchSlug },
        }).href
        const expectedCurrentHref =
          routePrecondition?.kind === 'current-workspace-target'
            ? workspacePaneHrefBelongsToBranch(currentHref, branchRootHref)
              ? currentHref
              : null
            : routePrecondition === undefined
              ? undefined
              : (routePrecondition.route === null
                  ? router.buildLocation({
                      to: '/repo/$repoSlug/branch/$branchSlug',
                      params: { repoSlug, branchSlug },
                    })
                  : routePrecondition.route.kind === 'static'
                    ? router.buildLocation({
                        to: '/repo/$repoSlug/branch/$branchSlug/tab/$tabKey',
                        params: { repoSlug, branchSlug, tabKey: routePrecondition.route.tab },
                      })
                    : router.buildLocation({
                        to: '/repo/$repoSlug/branch/$branchSlug/terminal/$terminalSessionId',
                        params: { repoSlug, branchSlug, terminalSessionId: routePrecondition.route.terminalSessionId },
                      })
                ).href
        if (expectedCurrentHref === null) return false
        const replace = options?.replace
        if (route === null) {
          const target = router.buildLocation({
            to: '/repo/$repoSlug/branch/$branchSlug',
            params: { repoSlug, branchSlug },
          })
          if (
            router.state.location.href === target.href &&
            primaryWindowRoutePreconditionMatches(router.state.location.href, expectedCurrentHref)
          ) {
            options?.onCommit?.()
            return true
          }
          return await settleOwnedPrimaryWindowRouteCommit({
            token: options?.presentationToken,
            commitEffect: options?.onCommit,
            targetHref: target.href,
            expectedCurrentHref,
            navigate: async (navigationId) => {
              await router.navigate({
                to: '/repo/$repoSlug/branch/$branchSlug',
                params: { repoSlug, branchSlug },
                replace,
                ignoreBlocker: true,
                state: (state) => primaryWindowNavigationState(state, navigationId),
              })
            },
            currentHref: () => router.state.location.href,
          })
        }
        if (route.kind === 'static') {
          const target = router.buildLocation({
            to: '/repo/$repoSlug/branch/$branchSlug/tab/$tabKey',
            params: { repoSlug, branchSlug, tabKey: route.tab },
          })
          if (
            router.state.location.href === target.href &&
            primaryWindowRoutePreconditionMatches(router.state.location.href, expectedCurrentHref)
          ) {
            options?.onCommit?.()
            return true
          }
          return await settleOwnedPrimaryWindowRouteCommit({
            token: options?.presentationToken,
            commitEffect: options?.onCommit,
            targetHref: target.href,
            expectedCurrentHref,
            navigate: async (navigationId) => {
              await router.navigate({
                to: '/repo/$repoSlug/branch/$branchSlug/tab/$tabKey',
                params: { repoSlug, branchSlug, tabKey: route.tab },
                replace,
                ignoreBlocker: true,
                state: (state) => primaryWindowNavigationState(state, navigationId),
              })
            },
            currentHref: () => router.state.location.href,
          })
        }
        const target = router.buildLocation({
          to: '/repo/$repoSlug/branch/$branchSlug/terminal/$terminalSessionId',
          params: {
            repoSlug,
            branchSlug,
            terminalSessionId: route.terminalSessionId,
          },
        })
        if (
          router.state.location.href === target.href &&
          primaryWindowRoutePreconditionMatches(router.state.location.href, expectedCurrentHref)
        ) {
          options?.onCommit?.()
          return true
        }
        return await settleOwnedPrimaryWindowRouteCommit({
          token: options?.presentationToken,
          commitEffect: options?.onCommit,
          targetHref: target.href,
          expectedCurrentHref,
          navigate: async (navigationId) => {
            await router.navigate({
              to: '/repo/$repoSlug/branch/$branchSlug/terminal/$terminalSessionId',
              params: {
                repoSlug,
                branchSlug,
                terminalSessionId: route.terminalSessionId,
              },
              replace,
              ignoreBlocker: true,
              state: (state) => primaryWindowNavigationState(state, navigationId),
            })
          },
          currentHref: () => router.state.location.href,
        })
      },
      openRepoNewWorktree(repoId, options) {
        const repoSlug = repoSlugForId(repoId)
        const href = router?.state.location.href ?? null
        if (repoSlug && router) {
          const targetPath = `/repo/${repoSlug}/worktree/new`
          const search =
            options?.returnTo === undefined
              ? routeReturnSearch(href, targetPath)
              : options.returnTo
                ? { returnTo: options.returnTo }
                : {}
          const target = router.buildLocation({ to: '/repo/$repoSlug/worktree/new', params: { repoSlug }, search })
          void runOwnedPrimaryWindowNavigation({
            token: options?.presentationToken,
            commitEffect: options?.onCommit,
            targetHref: target.href,
            navigate: async (navigationId) => {
              await router.navigate({
                to: '/repo/$repoSlug/worktree/new',
                params: { repoSlug },
                search,
                state: (state) => primaryWindowNavigationState(state, navigationId),
              })
            },
          })
        }
      },
      cancelRepoNewWorktree(repoId, options) {
        const href = returnToFromHref(router?.state.location.href ?? null)
        if (href && router) {
          void runOwnedPrimaryWindowNavigation({
            token: options?.presentationToken,
            commitEffect: options?.onCommit,
            targetHref: href,
            navigate: async (navigationId) => {
              router.history.push(href, primaryWindowNavigationState(router.state.location.state, navigationId))
            },
          })
        } else {
          const repoSlug = repoSlugForId(repoId)
          if (repoSlug) this.openRepoRoot(repoId, options)
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
  token?: PrimaryWindowPresentationToken
  targetHref: string
  commitEffect?: () => void
  navigate(navigationId: string): Promise<unknown>
}): boolean {
  const token = input.token ?? beginPrimaryWindowPresentation()
  const navigationId = registerPrimaryWindowNavigation(token, input.targetHref, input.commitEffect)
  if (!navigationId) return false
  void input
    .navigate(navigationId)
    .finally(() => releasePrimaryWindowNavigation(navigationId))
    .catch(() => {})
  return true
}

async function settleOwnedPrimaryWindowRouteCommit(input: {
  token?: PrimaryWindowPresentationToken
  targetHref: string
  expectedCurrentHref?: string
  commitEffect?: () => void
  navigate(navigationId: string): Promise<void>
  currentHref(): string
}): Promise<boolean> {
  const token = input.token ?? beginPrimaryWindowPresentation()
  const navigationId = registerPrimaryWindowNavigation(token, input.targetHref, input.commitEffect)
  if (!navigationId) return false
  try {
    return await settlePrimaryWindowRouteCommit({
      targetHref: input.targetHref,
      expectedCurrentHref: input.expectedCurrentHref,
      navigate: async () => await input.navigate(navigationId),
      currentHref: input.currentHref,
    })
  } finally {
    releasePrimaryWindowNavigation(navigationId)
  }
}

export async function settlePrimaryWindowRouteCommit(input: {
  targetHref: string
  expectedCurrentHref?: string
  navigate: () => Promise<void>
  currentHref: () => string
}): Promise<boolean> {
  if (!primaryWindowRoutePreconditionMatches(input.currentHref(), input.expectedCurrentHref)) return false
  try {
    await input.navigate()
  } catch {
    return false
  }
  return input.currentHref() === input.targetHref
}

export function primaryWindowRoutePreconditionMatches(
  currentHref: string,
  expectedCurrentHref: string | undefined,
): boolean {
  return expectedCurrentHref === undefined || currentHref === expectedCurrentHref
}

export function workspacePaneHrefBelongsToBranch(currentHref: string, branchRootHref: string): boolean {
  const currentPath = pathFromHref(currentHref)
  const branchRootPath = pathFromHref(branchRootHref)
  if (!currentPath || !branchRootPath) return false
  return (
    currentPath === branchRootPath ||
    currentPath.startsWith(`${branchRootPath}/tab/`) ||
    currentPath.startsWith(`${branchRootPath}/terminal/`)
  )
}

function repoSlugForId(repoId: string): string | null {
  const repo = useReposStore.getState().repos[repoId]
  return repo ? repoSlugFromId(repo.id) : null
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
