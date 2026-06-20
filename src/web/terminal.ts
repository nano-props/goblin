import { getRendererBridge } from '#/web/renderer-bridge.ts'
import type { RendererTerminalBridge } from '#/web/renderer-bridge-types.ts'

function getTerminalBridge(): RendererTerminalBridge {
  return getRendererBridge().terminal()
}

function bindTerminalMethod<TKey extends keyof RendererTerminalBridge>(key: TKey): RendererTerminalBridge[TKey] {
  return ((...args: Parameters<RendererTerminalBridge[TKey]>) => {
    const method = getTerminalBridge()[key] as (
      ...innerArgs: Parameters<RendererTerminalBridge[TKey]>
    ) => ReturnType<RendererTerminalBridge[TKey]>
    return method(...args)
  }) as unknown as RendererTerminalBridge[TKey]
}

export const terminalBridge: RendererTerminalBridge = {
  attach: bindTerminalMethod('attach'),
  restart: bindTerminalMethod('restart'),
  write: bindTerminalMethod('write'),
  resize: bindTerminalMethod('resize'),
  takeover: bindTerminalMethod('takeover'),
  close: bindTerminalMethod('close'),
  create: bindTerminalMethod('create'),
  pruneTerminals: bindTerminalMethod('pruneTerminals'),
  listSessions: bindTerminalMethod('listSessions'),
  listViews: bindTerminalMethod('listViews'),
  openView: bindTerminalMethod('openView'),
  closeView: bindTerminalMethod('closeView'),
  prewarm: bindTerminalMethod('prewarm'),
  kickReconnect: bindTerminalMethod('kickReconnect'),
  getSessionSnapshot: bindTerminalMethod('getSessionSnapshot'),
  reorderViews: bindTerminalMethod('reorderViews'),
  notifyBell: bindTerminalMethod('notifyBell'),
  sendTestNotification: bindTerminalMethod('sendTestNotification'),
  setBadge: bindTerminalMethod('setBadge'),
  onOutput: bindTerminalMethod('onOutput'),
  onTitle: bindTerminalMethod('onTitle'),
  onExit: bindTerminalMethod('onExit'),
  onOwnership: bindTerminalMethod('onOwnership'),
  onSessionsChanged: bindTerminalMethod('onSessionsChanged'),
  onSessionClosed: bindTerminalMethod('onSessionClosed'),
}
