import { useEffect, useRef } from 'react'
import { isRemoteRepoId } from '#/shared/remote-repo.ts'
import { runRemoteRepoConnection } from '#/web/stores/repos/remote-repo-connection-command.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { ReposGet, ReposSet } from '#/web/stores/repos/types.ts'

/**
 * Re-probe remote repos when the browser reports we are back
 * online.
 *
 * Per docs/goblin-remote-repo-refactor-plan.md §1 and §6, "网络
 * 变动导致 tab 一直转圈" is a root symptom of an unowned
 * `connecting` state. The `useNetworkReconnect` hook re-enters
 * the server command for *all* remote repos on a connectivity
 * change — both `failed` and `connecting` repos get a fresh
 * probe. Re-probing a `connecting` repo is safe: the
 * server attempt's latest-wins semantics abort the in-flight run
 * (which may be stuck against a dead network connection) and
 * start a new one with fresh signal state. Without this, a
 * `connecting` probe that started before the network came back
 * holds its 20s SSH timeout before the user sees a `failed`
 * state that the next `online` event would re-probe.
 *
 * Throttling: the browser fires `online` after the OS reports a
 * route change; in practice the user reopens wifi/VPN seconds
 * before the OS catches up, so the first probe often still
 * fails. We don't retry inside the hook — the failed
 * `runRemoteRepoConnection` call settles to `failed` and the
 * next `online` event gives the next attempt.
 */
export function useNetworkReconnect(): void {
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
        // `ready` is the success terminus — no re-probe needed.
        // `failed` and `connecting` repos both get a fresh probe.
        // For `connecting`, the server runtime's latest-wins abort
        // kills the stale in-flight run and starts over with the
        // now-working network.
        if (lifecycle?.kind === 'ready') continue
        void runRemoteRepoConnection(set, get, repo.id)
      }
    }
    window.addEventListener('online', onOnline)
    return () => {
      window.removeEventListener('online', onOnline)
    }
  }, [])
}
