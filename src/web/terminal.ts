import { getClientBridge } from '#/web/client-bridge.ts'
import type { ClientTerminal } from '#/web/client-bridge-types.ts'

function getTerminalClient(): ClientTerminal {
  return getClientBridge().terminal()
}

function bindTerminalMethod<TKey extends keyof ClientTerminal>(key: TKey): ClientTerminal[TKey] {
  return ((...args: Parameters<ClientTerminal[TKey]>) => {
    const method = getTerminalClient()[key] as (
      ...innerArgs: Parameters<ClientTerminal[TKey]>
    ) => ReturnType<ClientTerminal[TKey]>
    return method(...args)
  }) as unknown as ClientTerminal[TKey]
}

export const terminalClient: ClientTerminal = {
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
  notifyBell: bindTerminalMethod('notifyBell'),
  sendTestNotification: bindTerminalMethod('sendTestNotification'),
  setBadge: bindTerminalMethod('setBadge'),
  onOutput: bindTerminalMethod('onOutput'),
  onBell: bindTerminalMethod('onBell'),
  onTitle: bindTerminalMethod('onTitle'),
  onExit: bindTerminalMethod('onExit'),
  onIdentity: bindTerminalMethod('onIdentity'),
  onLifecycle: bindTerminalMethod('onLifecycle'),
  onSessionsChanged: bindTerminalMethod('onSessionsChanged'),
  onWorkspaceTabsChanged: bindTerminalMethod('onWorkspaceTabsChanged'),
  onSessionClosed: bindTerminalMethod('onSessionClosed'),
}
