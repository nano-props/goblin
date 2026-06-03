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
import type { TerminalOwnershipViewModel } from '#/web/components/terminal/types.ts'
export const terminalBridge = {
  attach(input: TerminalAttachInput): Promise<TerminalAttachResult> {
    return getRendererBridge().terminal().attach(input)
  },
  restart(input: TerminalRestartInput): Promise<TerminalAttachResult> {
    return getRendererBridge().terminal().restart(input)
  },
  write(input: TerminalWriteInput): Promise<TerminalMutationResult> {
    return getRendererBridge().terminal().write(input)
  },
  resize(input: TerminalResizeInput): Promise<TerminalMutationResult> {
    return getRendererBridge().terminal().resize(input)
  },
  takeover(input: TerminalTakeoverInput): Promise<TerminalTakeoverResult> {
    return getRendererBridge().terminal().takeover(input)
  },
  close(input: TerminalSessionInput): Promise<TerminalMutationResult> {
    return getRendererBridge().terminal().close(input)
  },
  create(input: TerminalCreateInput): Promise<TerminalCatalogMutationResult> {
    return getRendererBridge().terminal().create(input)
  },
  pruneTerminals(repoRoot: string): Promise<{ pruned: number; remaining: number }> {
    return getRendererBridge().terminal().pruneTerminals(repoRoot)
  },
  listSessions(input: { repoRoot: string }): Promise<TerminalSessionSummary[]> {
    return getRendererBridge().terminal().listSessions(input)
  },
  getSessionSnapshot(input: TerminalSessionSnapshotInput): Promise<TerminalSessionSnapshot | null> {
    return getRendererBridge().terminal().getSessionSnapshot(input)
  },
  notifyBell(input: TerminalNotifyBellInput): Promise<TerminalMutationResult> {
    return getRendererBridge().terminal().notifyBell(input)
  },
  sendTestNotification(): Promise<boolean> {
    return getRendererBridge().terminal().sendTestNotification()
  },
  setBadge(count: number): void {
    getRendererBridge().terminal().setBadge(count)
  },
  onOutput(cb: (event: TerminalOutputEvent) => void): () => void {
    return getRendererBridge().terminal().onOutput(cb)
  },
  onTitle(cb: (event: TerminalTitleEvent) => void): () => void {
    return getRendererBridge().terminal().onTitle(cb)
  },
  onExit(cb: (event: TerminalExitEvent) => void): () => void {
    return getRendererBridge().terminal().onExit(cb)
  },
  onOwnership(cb: (event: TerminalOwnershipViewModel) => void): () => void {
    return getRendererBridge().terminal().onOwnership(cb)
  },
  onSessionsChanged(cb: (repoRoot: string) => void): () => void {
    return getRendererBridge().terminal().onSessionsChanged(cb)
  },
}
