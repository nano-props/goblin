import { getClientBridge } from '#/web/client-bridge.ts'
import type { ClientAppRealtimeLifecycle } from '#/web/client-bridge-types.ts'

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
