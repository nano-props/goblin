import {
  WORKSPACE_PANE_TABS_REALTIME_EVENTS,
  WORKSPACE_PANE_TABS_SOCKET_ACTIONS,
} from '#/shared/workspace-pane-tabs.ts'
import type { WorkspacePaneTabsSnapshot } from '#/shared/workspace-pane-tabs.ts'
import { normalizeWorkspacePaneTabsSnapshot } from '#/shared/workspace-pane-tabs-validators.ts'
import type { AppRealtimeMessage } from '#/shared/app-realtime-socket.ts'
import type { ClientWorkspacePaneTabs } from '#/web/client-bridge-types.ts'
import type { ClientAppRealtime } from '#/web/app-realtime-client.ts'

export function createServerWorkspacePaneTabsClient(realtime: ClientAppRealtime): ClientWorkspacePaneTabs {
  const changedSubscribers = new Set<(repoRoot: string) => void>()
  let realtimeUnsubscribe: (() => void) | null = null

  return {
    replace(input) {
      return realtime
        .request(WORKSPACE_PANE_TABS_SOCKET_ACTIONS.replace, input)
        .then((value) => requireSnapshot(value, 'replace'))
    },
    update(input) {
      return realtime
        .request(WORKSPACE_PANE_TABS_SOCKET_ACTIONS.update, input)
        .then((value) => requireSnapshot(value, 'update'))
    },
    list(input) {
      return realtime
        .request(WORKSPACE_PANE_TABS_SOCKET_ACTIONS.list, input)
        .then((value) => requireSnapshot(value, 'list'))
    },
    onChanged(cb) {
      changedSubscribers.add(cb)
      ensureRealtimeSubscription()
      return () => {
        changedSubscribers.delete(cb)
        closeRealtimeSubscriptionIfIdle()
      }
    },
  }

  function requireSnapshot(value: unknown, operation: 'list' | 'replace' | 'update'): WorkspacePaneTabsSnapshot {
    const snapshot = normalizeWorkspacePaneTabsSnapshot(value)
    if (!snapshot) throw new Error(`Workspace pane tabs socket response failed: invalid ${operation} response`)
    return snapshot
  }

  function ensureRealtimeSubscription(): void {
    if (realtimeUnsubscribe) return
    realtimeUnsubscribe = realtime.onMessage(handleRealtimeMessage)
  }

  function closeRealtimeSubscriptionIfIdle(): void {
    if (changedSubscribers.size > 0 || !realtimeUnsubscribe) return
    realtimeUnsubscribe()
    realtimeUnsubscribe = null
  }

  function handleRealtimeMessage(message: AppRealtimeMessage): void {
    if (message.type !== WORKSPACE_PANE_TABS_REALTIME_EVENTS.changed) return
    for (const subscriber of changedSubscribers) subscriber(message.repoRoot)
  }
}
