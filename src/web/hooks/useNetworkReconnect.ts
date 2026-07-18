import { useEffect, useRef } from 'react'
import { isRemoteRepoId } from '#/shared/remote-repo.ts'
import { runRemoteWorkspaceConnection } from '#/web/stores/workspaces/remote-workspace-connection-command.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import type { WorkspacesGet, WorkspacesSet } from '#/web/stores/workspaces/types.ts'
import { goblinLog } from '#/web/logger.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'

function reconnectRemoteRepo(set: WorkspacesSet, get: WorkspacesGet, repoId: string): void {
  const workspaceId = canonicalWorkspaceLocator(repoId)
  if (!workspaceId) return
  void runRemoteWorkspaceConnection(set, get, workspaceId).then((outcome) => {
    if (outcome?.kind === 'transport-failed') {
      goblinLog.warn('remote reconnect command failed', { repoId, reason: outcome.reason })
    }
  })
}

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
 * `runRemoteWorkspaceConnection` call settles to `failed` and the
 * next `online` event gives the next attempt.
 */
export function useNetworkReconnect(): void {
  const setRef = useRef<WorkspacesSet>(useWorkspacesStore.setState)
  const getRef = useRef<WorkspacesGet>(useWorkspacesStore.getState)
  setRef.current = useWorkspacesStore.setState
  getRef.current = useWorkspacesStore.getState

  useEffect(() => {
    function onOnline() {
      const set = setRef.current
      const get = getRef.current
      const repos = get().workspaces
      for (const repo of Object.values(repos)) {
        if (!isRemoteRepoId(repo.id)) continue
        const lifecycle = repo.remote.lifecycle
        // `ready` is the success terminus — no re-probe needed.
        // `failed` and `connecting` repos both get a fresh probe.
        // For `connecting`, the server runtime's latest-wins abort
        // kills the stale in-flight run and starts over with the
        // now-working network.
        if (lifecycle?.kind === 'ready') continue
        reconnectRemoteRepo(set, get, repo.id)
      }
    }
    window.addEventListener('online', onOnline)
    return () => {
      window.removeEventListener('online', onOnline)
    }
  }, [])
}
