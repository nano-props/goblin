import type { RendererBootstrapSnapshot, RendererNativeCapability, RendererRuntimeKind } from '#/shared/bootstrap.ts'
import type { IpcEvent, IpcRequest, SettingsPage } from '#/shared/api-types.ts'
import type { RendererEffectIntent } from '#/shared/renderer-effect-intents.ts'
import type { ExecResult } from '#/shared/git-types.ts'
import type {
  TerminalCatalogMutationResult,
  TerminalAttachInput,
  TerminalAttachResult,
  TerminalCreateInput,
  TerminalExitEvent,
  TerminalMutationResult,
  TerminalNotifyBellInput,
  TerminalOutputEvent,
  TerminalReorderInput,
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
import type { TerminalOwnershipViewModel } from '#/web/components/terminal/types.ts'

export interface RendererTerminalBridge {
  attach: (input: TerminalAttachInput) => Promise<TerminalAttachResult>
  restart: (input: TerminalRestartInput) => Promise<TerminalAttachResult>
  write: (input: TerminalWriteInput) => Promise<TerminalMutationResult>
  resize: (input: TerminalResizeInput) => Promise<TerminalMutationResult>
  takeover: (input: TerminalTakeoverInput) => Promise<TerminalTakeoverResult>
  close: (input: TerminalSessionInput) => Promise<TerminalMutationResult>
  create: (input: TerminalCreateInput) => Promise<TerminalCatalogMutationResult>
  pruneTerminals: (repoRoot: string) => Promise<{ pruned: number; remaining: number }>
  listSessions: (input: { repoRoot: string }) => Promise<TerminalSessionSummary[]>
  getSessionSnapshot: (input: TerminalSessionSnapshotInput) => Promise<TerminalSessionSnapshot | null>
  reorder: (input: TerminalReorderInput) => Promise<TerminalMutationResult>
  notifyBell: (input: TerminalNotifyBellInput) => Promise<TerminalMutationResult>
  sendTestNotification: () => Promise<boolean>
  setBadge: (count: number) => void
  onOutput: (cb: (event: TerminalOutputEvent) => void) => () => void
  onTitle: (cb: (event: TerminalTitleEvent) => void) => () => void
  onExit: (cb: (event: TerminalExitEvent) => void) => () => void
  onOwnership: (cb: (event: TerminalOwnershipViewModel) => void) => () => void
  onSessionsChanged: (cb: (repoRoot: string) => void) => () => void
}

export interface RendererShellBridge {
  openSettingsWindow: (input?: { page?: SettingsPage }) => Promise<boolean>
  openExternalUrl: (input: { url: string; allowHttp?: boolean }) => Promise<ExecResult>
  openDirectoryDialog: (input?: { title?: string }) => Promise<string | null>
  consumeExternalOpenPaths: () => Promise<string[]>
  openInFinder: (input: { path: string }) => Promise<ExecResult>
}

export interface RendererBridge {
  kind(): RendererRuntimeKind
  hasCapability(capability: RendererNativeCapability): boolean
  getBootstrap(): RendererBootstrapSnapshot
  invokeIpc(request: IpcRequest): Promise<unknown>
  abortIpc(requestId: string): Promise<boolean>
  onIpcEvent(cb: (event: IpcEvent) => void): () => void
  onEffectIntent(cb: (event: RendererEffectIntent) => void): () => void
  pathForFile(file: File): string
  shell(): RendererShellBridge | null
  terminal(): RendererTerminalBridge
}
