import { resolveRepoWriteBoundaryKey } from '#/server/modules/repo-source.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

const boundaryByRepoId = new Map<WorkspaceId, string>()
const lastSuccessfulFetchAtByBoundary = new Map<string, number>()
const redirectedBoundary = new Map<string, string>()

function representativeBoundaryKey(boundaryKey: string): string {
  let current = boundaryKey
  const visited: string[] = []
  while (redirectedBoundary.has(current)) {
    visited.push(current)
    current = redirectedBoundary.get(current)!
  }
  for (const key of visited) redirectedBoundary.set(key, current)
  return current
}

function fallbackRemoteBoundaryKey(repoId: WorkspaceId): string {
  return `remote-git:${repoId}`
}

function bindResolvedBoundary(repoId: WorkspaceId, resolvedKey: string): string {
  const previousKey = boundaryByRepoId.get(repoId)
  const representativeResolvedKey = representativeBoundaryKey(resolvedKey)
  if (!previousKey || previousKey === representativeResolvedKey) {
    boundaryByRepoId.set(repoId, representativeResolvedKey)
    return representativeResolvedKey
  }

  const fallbackKey = fallbackRemoteBoundaryKey(repoId)
  if (representativeResolvedKey === fallbackKey && previousKey !== fallbackKey) return previousKey

  boundaryByRepoId.set(repoId, representativeResolvedKey)
  if (previousKey === fallbackKey) {
    const previousTimestamp = lastSuccessfulFetchAtByBoundary.get(previousKey)
    const resolvedTimestamp = lastSuccessfulFetchAtByBoundary.get(representativeResolvedKey)
    if (previousTimestamp !== undefined) {
      lastSuccessfulFetchAtByBoundary.set(
        representativeResolvedKey,
        Math.max(previousTimestamp, resolvedTimestamp ?? 0),
      )
      lastSuccessfulFetchAtByBoundary.delete(previousKey)
    }
    redirectedBoundary.set(previousKey, representativeResolvedKey)
  }
  return representativeResolvedKey
}

export async function resolveRepoWriteBoundary(
  repoId: WorkspaceId,
  signal?: AbortSignal,
): Promise<string> {
  return bindResolvedBoundary(repoId, await resolveRepoWriteBoundaryKey(repoId, signal))
}

export function recordRepoBoundaryFetchSuccess(boundaryKey: string): void {
  const representative = representativeBoundaryKey(boundaryKey)
  lastSuccessfulFetchAtByBoundary.set(
    representative,
    Math.max(lastSuccessfulFetchAtByBoundary.get(representative) ?? 0, Date.now()),
  )
}

export function getRepoBoundaryLastFetchAt(boundaryKey: string): number | null {
  return lastSuccessfulFetchAtByBoundary.get(representativeBoundaryKey(boundaryKey)) ?? null
}

export function resetRepoWriteBoundaryRegistryForTests(): void {
  boundaryByRepoId.clear()
  lastSuccessfulFetchAtByBoundary.clear()
  redirectedBoundary.clear()
}
