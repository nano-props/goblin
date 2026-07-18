import { useEffect, useRef } from 'react'
import { isRemoteWorkspaceId } from '#/shared/remote-workspace.ts'
import { runRemoteWorkspaceConnection } from '#/web/stores/workspaces/remote-workspace-connection-command.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import type { WorkspacesGet, WorkspacesSet } from '#/web/stores/workspaces/types.ts'
import { goblinLog } from '#/web/logger.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

function reconnectRemoteWorkspace(set: WorkspacesSet, get: WorkspacesGet, workspaceId: WorkspaceId): void {
  void runRemoteWorkspaceConnection(set, get, workspaceId).then((outcome) => {
    if (outcome?.kind === 'transport-failed') {
      goblinLog.warn('remote workspace reconnect command failed', { workspaceId, reason: outcome.reason })
    }
  })
}

/**
 * Re-probe remote workspaces when the browser reports we are back
 * online.
 *
 * A connectivity change can strand an in-flight SSH attempt until its
 * timeout. The hook re-enters the server command for every non-ready remote
 * workspace. Re-probing a `connecting` workspace is safe: the
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
      const workspaces = get().workspaces
      for (const workspace of Object.values(workspaces)) {
        if (!isRemoteWorkspaceId(workspace.id)) continue
        if (workspace.admission.kind !== 'remote') continue
        const lifecycle = workspace.admission.lifecycle
        // `ready` is the success terminus — no re-probe needed.
        // `failed` and `connecting` repos both get a fresh probe.
        // For `connecting`, the server runtime's latest-wins abort
        // kills the stale in-flight run and starts over with the
        // now-working network.
        if (lifecycle?.kind === 'ready') continue
        reconnectRemoteWorkspace(set, get, workspace.id)
      }
    }
    window.addEventListener('online', onOnline)
    return () => {
      window.removeEventListener('online', onOnline)
    }
  }, [])
}
