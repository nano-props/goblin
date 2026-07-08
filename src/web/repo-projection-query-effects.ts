import { useEffect } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { parseRepoProjectionQueryKey } from '#/web/repo-data-query.ts'
import { acceptRepoProjectionReadModel } from '#/web/stores/repos/projection-read-model-effects.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { RepoRuntimeProjection } from '#/shared/api-types.ts'

interface ProjectionQueryVersionState {
  invalidationVersion: number
  fetchVersion: number | null
}

function isRepoRuntimeProjection(value: unknown): value is RepoRuntimeProjection {
  if (!value || typeof value !== 'object') return false
  const projection = value as Partial<RepoRuntimeProjection>
  return (
    typeof projection.loadedAt === 'number' &&
    !!projection.operations &&
    typeof projection.operations === 'object' &&
    !!projection.requested &&
    typeof projection.requested === 'object'
  )
}

export function useRepoProjectionQueryEffects(queryClient: QueryClient = primaryWindowQueryClient): void {
  useEffect(() => {
    const versionsByQueryHash = new Map<string, ProjectionQueryVersionState>()
    const versionState = (queryHash: string) => {
      let state = versionsByQueryHash.get(queryHash)
      if (!state) {
        state = { invalidationVersion: 0, fetchVersion: null }
        versionsByQueryHash.set(queryHash, state)
      }
      return state
    }
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'removed') {
        versionsByQueryHash.delete(event.query.queryHash)
        return
      }
      if (event.type !== 'updated') return
      const parsed = parseRepoProjectionQueryKey(event.query.queryKey)
      if (!parsed) return
      const state = versionState(event.query.queryHash)
      if (event.action.type === 'fetch') {
        state.fetchVersion = state.invalidationVersion
        return
      }
      if (event.action.type === 'invalidate') {
        state.invalidationVersion += 1
        return
      }
      if (event.action.type !== 'success') return
      if (state.fetchVersion !== null && state.fetchVersion < state.invalidationVersion) {
        state.fetchVersion = null
        return
      }
      state.fetchVersion = null
      const data = event.query.state.data
      if (!isRepoRuntimeProjection(data)) return
      acceptRepoProjectionReadModel(useReposStore.setState, useReposStore.getState, {
        repoRoot: parsed.repoRoot,
        repoRuntimeId: parsed.repoRuntimeId,
        projection: data,
      })
    })
  }, [queryClient])
}
