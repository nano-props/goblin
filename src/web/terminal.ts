import type {
  TerminalAttachInput,
  TerminalAttachResult,
  TerminalCatalogMutationResult,
  TerminalCreateInput,
  TerminalExitEvent,
  TerminalMutationResult,
  TerminalNotifyBellInput,
  TerminalOutputEvent,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionSnapshot,
  TerminalSessionSnapshotInput,
  TerminalSessionSummary,
  TerminalSessionInput,
  TerminalTakeoverInput,
  TerminalTakeoverResult,
  TerminalTitleEvent,
  TerminalWriteInput,
} from '#/shared/terminal.ts'
import { getRendererBridge } from '#/web/renderer-bridge.ts'
import type { RendererTerminalBridge } from '#/web/renderer-bridge-types.ts'
import type { TerminalOwnershipViewModel } from '#/web/components/terminal/types.ts'

function getTerminalBridge(): RendererTerminalBridge {
  return getRendererBridge().terminal()
}

function bindTerminalMethod<TKey extends keyof RendererTerminalBridge>(key: TKey): RendererTerminalBridge[TKey] {
  return ((...args: Parameters<RendererTerminalBridge[TKey]>) => {
    const method = getTerminalBridge()[key] as (...innerArgs: Parameters<RendererTerminalBridge[TKey]>) => ReturnType<RendererTerminalBridge[TKey]>
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
  getSessionSnapshot: bindTerminalMethod('getSessionSnapshot'),
  notifyBell: bindTerminalMethod('notifyBell'),
  sendTestNotification: bindTerminalMethod('sendTestNotification'),
  setBadge: bindTerminalMethod('setBadge'),
  onOutput: bindTerminalMethod('onOutput'),
  onTitle: bindTerminalMethod('onTitle'),
  onExit: bindTerminalMethod('onExit'),
  onOwnership: bindTerminalMethod('onOwnership'),
  onSessionsChanged: bindTerminalMethod('onSessionsChanged'),
}
