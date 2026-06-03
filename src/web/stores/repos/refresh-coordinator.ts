import type { DetailTab, ReposGet } from '#/web/stores/repos/types.ts'

interface RepoRefreshIntentBase {
  id: string
  token: number
}

export type RepoRefreshIntent =
  | (RepoRefreshIntentBase & { kind: 'initial-load' })
  | (RepoRefreshIntentBase & { kind: 'manual-refresh-requested' })
  | (RepoRefreshIntentBase & {
      kind: 'branch-view-mode-changed'
      selectedForPullRequest: string | null
    })
  | (RepoRefreshIntentBase & {
      kind: 'detail-tab-changed'
      tab: DetailTab | undefined
      selectedBranch: string | null | undefined
    })
  | (RepoRefreshIntentBase & { kind: 'selected-branch-changed'; branch: string; tab: DetailTab | undefined })
  | (RepoRefreshIntentBase & { kind: 'selected-branch-status'; selectedBranch: string | null | undefined })
  | (RepoRefreshIntentBase & { kind: 'branch-action-settled' })
  | (RepoRefreshIntentBase & { kind: 'repo-invalidated' })

export async function runRepoRefreshIntent(get: ReposGet, intent: RepoRefreshIntent): Promise<void> {
  switch (intent.kind) {
    case 'manual-refresh-requested':
      await get().syncAndRefresh(intent.id, { token: intent.token })
      return
    case 'initial-load':
    case 'branch-action-settled':
    case 'repo-invalidated':
      await Promise.all([
        get().refreshSnapshot(intent.id, { token: intent.token }),
        get().refreshStatus(intent.id, { token: intent.token }),
      ])
      return
    case 'branch-view-mode-changed': {
      const tasks: Array<Promise<void>> = []
      if (intent.selectedForPullRequest) {
        tasks.push(get().refreshPullRequests(intent.id, [intent.selectedForPullRequest], { token: intent.token, mode: 'full' }))
      }
      if (tasks.length === 0) return
      await Promise.all(tasks)
      return
    }
    case 'detail-tab-changed': {
      if (intent.tab === 'status' && intent.selectedBranch) {
        await get().refreshPullRequests(intent.id, [intent.selectedBranch], { token: intent.token, mode: 'full' })
      }
      return
    }
    case 'selected-branch-changed':
      await get().refreshPullRequests(intent.id, [intent.branch], { token: intent.token, mode: 'full' })
      return
    case 'selected-branch-status':
      if (!intent.selectedBranch) return
      await get().refreshPullRequests(intent.id, [intent.selectedBranch], { token: intent.token, mode: 'full' })
      return
  }
  const exhaustive: never = intent
  return exhaustive
}
