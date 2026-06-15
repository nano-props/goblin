import { useEffect, useRef } from 'react'
import { isRemoteRepoId } from '#/shared/remote-repo.ts'
import { runRemoteRepoLifecycle } from '#/web/stores/repos/remote-lifecycle-orchestrator.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { ReposGet, ReposSet } from '#/web/stores/repos/types.ts'

/**
 * Re-probe remote repos when the browser reports we are back
 * online.
 *
 * Per docs/goblin-remote-repo-refactor-plan.md §1 and §6, "网络
 * 变动导致 tab 一直转圈" is a root symptom of an unowned
 * `connecting` state. The `useNetworkReconnect` hook is the
 * only caller that re-enters the orchestrator for *all* remote
 * repos on a connectivity change — every other entry point is
 * user-driven (open / retry) or boot-driven (hydrate).
 *
 * Re-entrancy is handled by the orchestrator itself (latest-wins
 * per repo) and by the in-flight tracking the orchestrator
 * already does. This hook is intentionally a thin dispatcher.
 *
 * Throttling: the browser fires `online` after the OS reports a
 * route change; in practice the user reopens wifi/VPN seconds
 * before the OS catches up, so the first probe often still
 * fails. We don't retry inside the hook — the failed
 * `useRemoteRepoLifecycle` call settles to `failed { reason:
 * 'unknown' }` (per §6.5) and the next user action / next
 * `online` event gives the next attempt.
 */
export function useNetworkReconnect(): void {
  // Avoid running the loop twice in React 19 StrictMode dev: the
  // hook installs the listener once, the effect cleanup removes
  // it, and the remount re-installs. The store is the source of
  // truth for the current repo set, so we always read from it
  // inside the listener (not from a captured snapshot).
  const setRef = useRef<ReposSet>(useReposStore.setState)
  const getRef = useRef<ReposGet>(useReposStore.getState)
  setRef.current = useReposStore.setState
  getRef.current = useReposStore.getState

  useEffect(() => {
    function onOnline() {
      const set = setRef.current
      const get = getRef.current
      const repos = get().repos
      for (const repo of Object.values(repos)) {
        if (!isRemoteRepoId(repo.id)) continue
        const lifecycle = repo.remote.lifecycle
        if (!lifecycle) continue
        if (lifecycle.kind === 'ready' || lifecycle.kind === 'connecting') {
          // A `ready` repo is the success terminus of a converged
          // lifecycle — no re-probe is needed when the network
          // comes back, because the next user-driven fetch will
          // surface any new failure. A `connecting` repo is
          // already in flight; the orchestrator owns its writes.
          continue
        }
        // `failed` repo: re-probe. The orchestrator flips it to
        // `connecting` (preserving the last-known target), runs
        // the resolution, and settles to `ready` or `failed`.
        void runRemoteRepoLifecycle(set, get, repo.id)
      }
    }
    window.addEventListener('online', onOnline)
    return () => {
      window.removeEventListener('online', onOnline)
    }
  }, [])
}
