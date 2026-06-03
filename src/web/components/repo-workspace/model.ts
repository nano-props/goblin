import { resourceInitialLoading } from '#/web/stores/repos/resources.ts'
import type { RepoState } from '#/web/stores/repos/types.ts'
export interface RepoWorkspacePresentation {
  exists: boolean
  initialLoading: boolean
}

export function getRepoWorkspacePresentation(repo: RepoState | undefined): RepoWorkspacePresentation {
  return {
    exists: !!repo,
    initialLoading: !!repo && resourceInitialLoading(repo.resources.snapshot),
  }
}
