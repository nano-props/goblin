import { getClientBridge } from '#/web/bridge/client.ts'
import type { ClientAppRealtimeLifecycle } from '#/web/bridge/types.ts'

function getAppRealtimeClient(): ClientAppRealtimeLifecycle {
  return getClientBridge().appRealtime()
}

export const appRealtimeClient: ClientAppRealtimeLifecycle = {
  kickReconnect() {
    getAppRealtimeClient().kickReconnect()
  },
  onRecovered(cb) {
    return getAppRealtimeClient().onRecovered(cb)
  },
}
