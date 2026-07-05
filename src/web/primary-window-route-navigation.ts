import { useRouter } from '@tanstack/react-router'
import { useMemo } from 'react'
import { branchSlugFromName, repoSlugFromId } from '#/web/repo-route-slugs.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { SettingsPage } from '#/shared/settings-pages.ts'

export interface PrimaryWindowRouteNavigation {
  repoSlugForId: (repoId: string) => string | null
  openHome: () => void
  openSettings: (page: SettingsPage) => void
  closeSettings: () => void
  openRepoDashboard: (repoId: string) => void
  openRepoBranch: (repoId: string, branchName: string, options?: { replace?: boolean }) => void
  openRepoNewWorktree: (repoId: string) => void
  cancelRepoNewWorktree: (repoId: string) => void
}

export function usePrimaryWindowRouteNavigation(): PrimaryWindowRouteNavigation {
  const router = useRouter({ warn: false })
  return useMemo(() => ({
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
        search: routeReturnSearch(href, '/settings'),
      })
    },
    closeSettings() {
      const href = returnToFromHref(router?.state.location.href ?? null)
      if (href) router?.history.push(href)
      else void router?.navigate({ to: '/' })
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
    openRepoNewWorktree(repoId) {
      const repoSlug = repoSlugForId(repoId)
      const href = router?.state.location.href ?? null
      if (repoSlug) {
        void router?.navigate({
          to: '/repo/$repoSlug/worktree/new',
          params: { repoSlug },
          search: routeReturnSearch(href, `/repo/${repoSlug}/worktree/new`),
        })
      }
    },
    cancelRepoNewWorktree(repoId) {
      const href = returnToFromHref(router?.state.location.href ?? null)
      if (href) router?.history.push(href)
      else {
        const repoSlug = repoSlugForId(repoId)
        if (repoSlug) void router?.navigate({ to: '/repo/$repoSlug/dashboard', params: { repoSlug } })
      }
    },
  }), [router])
}

function repoSlugForId(repoId: string): string | null {
  const repo = useReposStore.getState().repos[repoId]
  return repo ? repoSlugFromId(repo.id) : null
}

export function routeReturnSearch(href: string | null, currentPath: string): { returnTo?: string } {
  if (!href) return {}
  const path = pathFromHref(href)
  if (!path || path === currentPath) return {}
  return { returnTo: href }
}

export function returnToFromHref(href: string | null): string | null {
  if (!href) return null
  const queryStart = href.indexOf('?')
  if (queryStart < 0) return null
  const hashStart = href.indexOf('#', queryStart)
  const search = href.slice(queryStart + 1, hashStart < 0 ? undefined : hashStart)
  const returnTo = new URLSearchParams(search).get('returnTo')
  return returnTo && returnTo.startsWith('/') ? returnTo : null
}

function pathFromHref(href: string): string | null {
  const queryStart = href.indexOf('?')
  const hashStart = href.indexOf('#')
  const end = queryStart >= 0 ? queryStart : hashStart >= 0 ? hashStart : href.length
  const path = href.slice(0, end)
  return path.startsWith('/') ? path : null
}
