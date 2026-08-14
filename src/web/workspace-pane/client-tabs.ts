import {
  WORKSPACE_PANE_TABS_REALTIME_EVENTS,
  WORKSPACE_PANE_TABS_SOCKET_ACTIONS,
} from '#/shared/workspace-pane-tabs.ts'
import type { WorkspacePaneTabsChangedRealtimeMessage } from '#/shared/workspace-pane-tabs.ts'
import type { AppRealtimeMessage } from '#/shared/app-realtime-socket.ts'
import type { ClientWorkspacePaneTabs } from '#/web/client-bridge-types.ts'
import type { ClientAppRealtime } from '#/web/app-realtime-client.ts'

export function createServerWorkspacePaneTabsClient(realtime: ClientAppRealtime): ClientWorkspacePaneTabs {
  const changedSubscribers = new Set<(message: WorkspacePaneTabsChangedRealtimeMessage) => void>()
  let realtimeUnsubscribe: (() => void) | null = null

  return {
    update(input) {
      return realtime.request(WORKSPACE_PANE_TABS_SOCKET_ACTIONS.update, input)
    },
    list(input) {
      return realtime.request(WORKSPACE_PANE_TABS_SOCKET_ACTIONS.list, input)
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
    for (const subscriber of changedSubscribers) subscriber(message)
  }
}
