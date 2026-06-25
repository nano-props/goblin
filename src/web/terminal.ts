import { getClientBridge } from '#/web/client-bridge.ts'
import type { ClientTerminalBridge } from '#/web/client-bridge-types.ts'

function getTerminalBridge(): ClientTerminalBridge {
  return getClientBridge().terminal()
}

function bindTerminalMethod<TKey extends keyof ClientTerminalBridge>(key: TKey): ClientTerminalBridge[TKey] {
  return ((...args: Parameters<ClientTerminalBridge[TKey]>) => {
    const method = getTerminalBridge()[key] as (
      ...innerArgs: Parameters<ClientTerminalBridge[TKey]>
    ) => ReturnType<ClientTerminalBridge[TKey]>
    return method(...args)
  }) as unknown as ClientTerminalBridge[TKey]
}

export const terminalBridge: ClientTerminalBridge = {
  attach: bindTerminalMethod('attach'),
  restart: bindTerminalMethod('restart'),
  write: bindTerminalMethod('write'),
  resize: bindTerminalMethod('resize'),
  takeover: bindTerminalMethod('takeover'),
  close: bindTerminalMethod('close'),
  create: bindTerminalMethod('create'),
  pruneTerminals: bindTerminalMethod('pruneTerminals'),
  listSessions: bindTerminalMethod('listSessions'),
  prewarm: bindTerminalMethod('prewarm'),
  kickReconnect: bindTerminalMethod('kickReconnect'),
  getSlotSnapshot: bindTerminalMethod('getSlotSnapshot'),
  notifyBell: bindTerminalMethod('notifyBell'),
  sendTestNotification: bindTerminalMethod('sendTestNotification'),
  setBadge: bindTerminalMethod('setBadge'),
  onOutput: bindTerminalMethod('onOutput'),
  onTitle: bindTerminalMethod('onTitle'),
  onExit: bindTerminalMethod('onExit'),
  onIdentity: bindTerminalMethod('onIdentity'),
  onLifecycle: bindTerminalMethod('onLifecycle'),
  onSessionsChanged: bindTerminalMethod('onSessionsChanged'),
  onSlotClosed: bindTerminalMethod('onSlotClosed'),
}
