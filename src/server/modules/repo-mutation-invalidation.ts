import { publishRepoReadInvalidation } from '#/server/modules/invalidation-broker.ts'
import type { RepoMutationResult } from '#/server/modules/repo-mutation-impact.ts'
import type { RepoReadInvalidationDomain } from '#/shared/repo-read-invalidation.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

export function publishRepoMutationInvalidations(
  workspaceId: WorkspaceId,
  result: RepoMutationResult,
  domains: readonly RepoReadInvalidationDomain[],
): void {
  const repoIdsToInvalidate = result.repoIdsToInvalidate ?? []
  if (repoIdsToInvalidate.length === 0) return
  const uniqueRepoIds = new Set([workspaceId, ...repoIdsToInvalidate])
  for (const repoId of uniqueRepoIds) {
    for (const domain of domains) publishRepoReadInvalidation({ repoId, domain })
  }
}
