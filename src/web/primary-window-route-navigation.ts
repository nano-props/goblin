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
  openRepoBranch: (repoId: string, branchName: string) => void
  openRepoNewWorktree: (repoId: string) => void
}

let settingsReturnHref: string | null = null

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
      if (href && !href.startsWith('/settings')) settingsReturnHref = href
      void router?.navigate({ to: '/settings/$page', params: { page } })
    },
    closeSettings() {
      const href = settingsReturnHref
      settingsReturnHref = null
      if (href) router?.history.push(href)
      else void router?.navigate({ to: '/' })
    },
    openRepoDashboard(repoId) {
      const repoSlug = repoSlugForId(repoId)
      if (repoSlug) void router?.navigate({ to: '/repo/$repoSlug/dashboard', params: { repoSlug } })
    },
    openRepoBranch(repoId, branchName) {
      const repoSlug = repoSlugForId(repoId)
      if (!repoSlug) return
      void router?.navigate({
        to: '/repo/$repoSlug/branch/$branchSlug',
        params: { repoSlug, branchSlug: branchSlugFromName(branchName) },
      })
    },
    openRepoNewWorktree(repoId) {
      const repoSlug = repoSlugForId(repoId)
      if (repoSlug) void router?.navigate({ to: '/repo/$repoSlug/worktree/new', params: { repoSlug } })
    },
  }), [router])
}

function repoSlugForId(repoId: string): string | null {
  const repo = useReposStore.getState().repos[repoId]
  return repo ? repoSlugFromId(repo.id) : null
}
