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
} from '#/shared/terminal-types.ts'
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
  /**
   * Persist clipboard / drop file blobs to a runtime-resolved location and
   * return absolute paths the PTY can read. Electron writes under
   * `<os.tmpdir>/goblin-clipboard-<pid>/`; web POSTs multipart to
   * `/api/clipboard/files` and the server writes under
   * `<serverDataDir()>/clipboard-tmp-<pid>/`. Returns `[]` on any failure
   * (the resolver maps that to a single `paste-file-failed` toast).
   */
  saveClipboardFiles(files: File[]): Promise<string[]>
  /**
   * Electron-only: invalidate the current access token, restart the
   * embedded server, and return the freshly-generated token. The
   * renderer surfaces the new value in the Web settings page so
   * the user can re-authenticate. Throws (via the IPC reject path)
   * when called from a non-Electron runtime; the Web settings page
   * gates the rotation button on `kind() === 'electron'`.
   */
  rotateAccessToken?(): Promise<{ accessToken: string }>
  shell(): RendererShellBridge | null
  terminal(): RendererTerminalBridge
}
