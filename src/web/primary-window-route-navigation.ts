import { useRouter } from '@tanstack/react-router'
import { useMemo } from 'react'
import { branchSlugFromName, repoSlugFromId } from '#/web/repo-route-slugs.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { SettingsPage } from '#/shared/settings-pages.ts'

export interface PrimaryWindowRouteNavigation {
  repoSlugForId: (repoId: string) => string | null
  openSettings: (page: SettingsPage) => void
  openRepoDashboard: (repoId: string) => void
  openRepoBranch: (repoId: string, branchName: string) => void
  openRepoNewWorktree: (repoId: string) => void
}

export function usePrimaryWindowRouteNavigation(): PrimaryWindowRouteNavigation {
  const router = useRouter({ warn: false })
  return useMemo(() => ({
    repoSlugForId(repoId) {
      const repo = useReposStore.getState().repos[repoId]
      return repo ? repoSlugFromId(repo.id) : null
    },
    openSettings(page) {
      void router?.navigate({ to: '/settings/$page', params: { page } })
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
