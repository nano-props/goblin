// Read orchestration for the worktree-scoped file tree (docs/filetree.md).
//
// Responsibilities of this hook:
//   1. Own the tree, loading, error, and stale slice for one
//      (repoId, worktreePath) pair.
//   2. Kick the initial fetch on mount and on input change.
//   3. Refetch when an invalidation event with query='repo-snapshot'
//      arrives for the active repoId (the spec chooses snapshot
//      invalidation as the refresh trigger; a dedicated
//      'repo-tree' query kind is intentionally not added in v1).
//   4. Cancel the in-flight request via AbortController when inputs
//      change or the consumer unmounts.
//
// Anti-coupling rules (enforced by review):
//   - Do not import useReposStore, terminal hooks, or settings.
//   - Do not publish new event channels; only subscribe.
//   - Do not import server modules or write to the network layer
//     directly -- go through filetree-client.

import { useCallback, useEffect, useRef, useState } from 'react'
import { getRepositoryTree } from '#/web/filetree-client.ts'
import { subscribeRepoQueryInvalidation } from '#/web/repo-query-invalidation-ingress.ts'
import type { RepoTreeResult } from '#/shared/api-types.ts'

export interface UseRepoTreeRefreshInput {
  readonly repoId: string
  readonly worktreePath: string
}

export interface UseRepoTreeRefreshResult {
  readonly tree: RepoTreeResult | null
  readonly loading: boolean
  readonly error: string | null
  readonly stale: boolean
  refresh(): void
}

const EMPTY_RESULT: RepoTreeResult = { nodes: [], truncated: false }

export function useRepoTreeRefresh(input: UseRepoTreeRefreshInput): UseRepoTreeRefreshResult {
  const { repoId, worktreePath } = input

  const [tree, setTree] = useState<RepoTreeResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)

  // AbortController for the in-flight request, if any. We keep the
  // controller in a ref so the latest supersedes the previous without
  // waiting for the next render.
  const controllerRef = useRef<AbortController | null>(null)
  // Tracks the active (repoId, worktreePath) tuple. Lets async
  // results decide whether they should still update state.
  const activeRef = useRef<{ repoId: string; worktreePath: string }>({ repoId, worktreePath })
  // Mounted flag: prevents setState after unmount.
  const mountedRef = useRef(true)

  useEffect(
    () => () => {
      mountedRef.current = false
      controllerRef.current?.abort()
      controllerRef.current = null
    },
    [],
  )

  // Fetch handler. Aborts any prior request, starts a new one, and
  // routes the result back into local state if the consumer is
  // still interested in this (repoId, worktreePath) pair.
  //
  // `stale` is intentionally NOT reset here -- the invalidation
  // listener owns that flag for the *current* worktree, and resetting
  // at fetch entry would clobber a setStale(true) that landed
  // synchronously alongside the fetch (the React batching would
  // collapse both into the last write). Stale is reset only when
  // (repoId, worktreePath) changes (see the input-change effect
  // below), so a freshly-mounted worktree never inherits "stale"
  // from the prior one.
  const fetchTree = useCallback(() => {
    if (!repoId || !worktreePath) {
      setTree(null)
      setLoading(false)
      setError(null)
      setStale(false)
      return
    }

    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    activeRef.current = { repoId, worktreePath }

    setLoading(true)
    setError(null)

    void getRepositoryTree(repoId, worktreePath, { signal: controller.signal })
      .then((result) => {
        if (!mountedRef.current) return
        const active = activeRef.current
        if (active.repoId !== repoId || active.worktreePath !== worktreePath) return
        if (controller.signal.aborted) return
        setTree(result)
        setError(null)
        setStale(false)
      })
      .catch((err: unknown) => {
        if (!mountedRef.current) return
        const active = activeRef.current
        if (active.repoId !== repoId || active.worktreePath !== worktreePath) return
        if (controller.signal.aborted) return
        // Wire soft-fail returns the empty envelope already; only
        // true errors reach this branch.
        const message = err instanceof Error ? err.message : String(err)
        setError(message || 'filetree error')
        // Soft-fail result: keep UI in a recoverable state, no
        // previous tree preserved (caller decides if it wants to).
        setTree(EMPTY_RESULT)
        setStale(false)
      })
      .finally(() => {
        if (!mountedRef.current) return
        if (controllerRef.current === controller) {
          setLoading(false)
        }
      })
  }, [repoId, worktreePath])

  // Refetch on input change. The `stale` flag is reset here, on the
  // (repoId, worktreePath) boundary, so a new worktree never inherits
  // "stale" from the prior one. The invalidation listener also calls
  // fetchTree directly, but its effect does not re-fire on those calls
  // (fetchTree's identity is stable for the same input pair), so the
  // reset only happens on real input changes.
  useEffect(() => {
    setStale(false)
    fetchTree()
    return () => {
      // Cancel any in-flight request when inputs change or the
      // effect tears down.
      controllerRef.current?.abort()
      controllerRef.current = null
    }
  }, [fetchTree])

  // Mark the current tree as stale when a snapshot invalidation
  // arrives for this repo, then kick a refetch. The listener owns
  // the stale flag: it sets it true on entry, and the fetch
  // resolution clears it back to false.
  useEffect(() => {
    return subscribeRepoQueryInvalidation((event) => {
      if (event.query !== 'repo-snapshot') return
      if (event.repoId !== repoId) return
      if (!mountedRef.current) return
      setStale(true)
      void fetchTree()
    })
  }, [repoId, fetchTree])

  return { tree, loading, error, stale, refresh: fetchTree }
}
