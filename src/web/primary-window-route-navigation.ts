import { useRouter } from '@tanstack/react-router'
import { useMemo } from 'react'
import { branchSlugFromName, repoSlugFromId } from '#/web/repo-route-slugs.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { SettingsPage } from '#/shared/settings-pages.ts'
import type { WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'

export interface PrimaryWindowRouteNavigation {
  repoSlugForId: (repoId: string) => string | null
  openHome: () => void
  openSettings: (page: SettingsPage) => void
  closeSettings: () => void
  openRepoRoot: (repoId: string) => void
  openRepoDashboard: (repoId: string) => void
  openRepoBranch: (repoId: string, branchName: string, options?: { replace?: boolean }) => void
  openRepoBranchTab: (
    repoId: string,
    branchName: string,
    tab: WorkspacePaneStaticTabType,
    options?: { replace?: boolean },
  ) => void
  openRepoBranchTerminal: (
    repoId: string,
    branchName: string,
    terminalSessionId: string,
    options?: { replace?: boolean },
  ) => void
  openRepoNewWorktree: (repoId: string, options?: { returnTo: string | null }) => void
  cancelRepoNewWorktree: (repoId: string) => void
}

export function usePrimaryWindowRouteNavigation(): PrimaryWindowRouteNavigation {
  const router = useRouter({ warn: false })
  return useMemo(
    () => ({
      repoSlugForId(repoId) {
        const repo = useReposStore.getState().repos[repoId]
        return repo ? repoSlugFromId(repo.id) : null
      },
      openHome() {
        void router?.navigate({ to: '/' })
      },
      openSettings(page) {
        const href = router?.state.location.href ?? null
        void router?.navigate({
          to: '/settings/$page',
          params: { page },
          search: routeReturnSearch(href, '/settings', '/settings'),
        })
      },
      closeSettings() {
        const href = returnToFromHref(router?.state.location.href ?? null)
        if (href) router?.history.push(href)
        else void router?.navigate({ to: '/' })
      },
      openRepoRoot(repoId) {
        const repoSlug = repoSlugForId(repoId)
        if (repoSlug) void router?.navigate({ to: '/repo/$repoSlug', params: { repoSlug } })
      },
      openRepoDashboard(repoId) {
        const repoSlug = repoSlugForId(repoId)
        if (repoSlug) void router?.navigate({ to: '/repo/$repoSlug/dashboard', params: { repoSlug } })
      },
      openRepoBranch(repoId, branchName, options) {
        const repoSlug = repoSlugForId(repoId)
        if (!repoSlug) return
        void router?.navigate({
          to: '/repo/$repoSlug/branch/$branchSlug',
          params: { repoSlug, branchSlug: branchSlugFromName(branchName) },
          replace: options?.replace,
        })
      },
      openRepoBranchTab(repoId, branchName, tab, options) {
        const repoSlug = repoSlugForId(repoId)
        if (!repoSlug) return
        void router?.navigate({
          to: '/repo/$repoSlug/branch/$branchSlug/tab/$tabKey',
          params: { repoSlug, branchSlug: branchSlugFromName(branchName), tabKey: tab },
          replace: options?.replace,
        })
      },
      openRepoBranchTerminal(repoId, branchName, terminalSessionId, options) {
        const repoSlug = repoSlugForId(repoId)
        if (!repoSlug) return
        void router?.navigate({
          to: '/repo/$repoSlug/branch/$branchSlug/terminal/$terminalSessionId',
          params: { repoSlug, branchSlug: branchSlugFromName(branchName), terminalSessionId },
          replace: options?.replace,
        })
      },
      openRepoNewWorktree(repoId, options) {
        const repoSlug = repoSlugForId(repoId)
        const href = router?.state.location.href ?? null
        if (repoSlug) {
          const targetPath = `/repo/${repoSlug}/worktree/new`
          const search = options
            ? options.returnTo
              ? { returnTo: options.returnTo }
              : {}
            : routeReturnSearch(href, targetPath)
          void router?.navigate({
            to: '/repo/$repoSlug/worktree/new',
            params: { repoSlug },
            search,
          })
        }
      },
      cancelRepoNewWorktree(repoId) {
        const href = returnToFromHref(router?.state.location.href ?? null)
        if (href) router?.history.push(href)
        else {
          const repoSlug = repoSlugForId(repoId)
          if (repoSlug) void router?.navigate({ to: '/repo/$repoSlug', params: { repoSlug } })
        }
      },
    }),
    [router],
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
