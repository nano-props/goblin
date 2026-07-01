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
  replaceWorkspaceTabs: bindTerminalMethod('replaceWorkspaceTabs'),
  updateWorkspaceTabs: bindTerminalMethod('updateWorkspaceTabs'),
  pruneTerminals: bindTerminalMethod('pruneTerminals'),
  listSessions: bindTerminalMethod('listSessions'),
  listWorkspaceTabs: bindTerminalMethod('listWorkspaceTabs'),
  prewarm: bindTerminalMethod('prewarm'),
  kickReconnect: bindTerminalMethod('kickReconnect'),
  getSessionSnapshot: bindTerminalMethod('getSessionSnapshot'),
  notifyBell: bindTerminalMethod('notifyBell'),
  sendTestNotification: bindTerminalMethod('sendTestNotification'),
  setBadge: bindTerminalMethod('setBadge'),
  onOutput: bindTerminalMethod('onOutput'),
  onTitle: bindTerminalMethod('onTitle'),
  onExit: bindTerminalMethod('onExit'),
  onIdentity: bindTerminalMethod('onIdentity'),
  onLifecycle: bindTerminalMethod('onLifecycle'),
  onSessionsChanged: bindTerminalMethod('onSessionsChanged'),
  onWorkspaceTabsChanged: bindTerminalMethod('onWorkspaceTabsChanged'),
  onSessionClosed: bindTerminalMethod('onSessionClosed'),
}
