import type { ClientBootstrapSnapshot, ClientNativeCapability, ClientRuntimeKind } from '#/shared/bootstrap.ts'
import type { IpcEvent, IpcRequest, SettingsPage } from '#/shared/api-types.ts'
import type { ClientEffectIntent } from '#/shared/client-effect-intents.ts'
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
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSlotSnapshot,
  TerminalSlotSnapshotInput,
  TerminalSlotSummary,
  TerminalSlotInput,
  TerminalTakeoverInput,
  TerminalTakeoverResult,
  TerminalTitleEvent,
  TerminalWriteInput,
} from '#/shared/terminal-types.ts'
import type { TerminalIdentityViewModel, TerminalLifecycleViewModel } from '#/web/components/terminal/types.ts'

export interface ClientTerminalBridge {
  attach: (input: TerminalAttachInput) => Promise<TerminalAttachResult>
  restart: (input: TerminalRestartInput) => Promise<TerminalAttachResult>
  write: (input: TerminalWriteInput) => Promise<TerminalMutationResult>
  resize: (input: TerminalResizeInput) => Promise<TerminalMutationResult>
  takeover: (input: TerminalTakeoverInput) => Promise<TerminalTakeoverResult>
  close: (input: TerminalSlotInput) => Promise<TerminalMutationResult>
  create: (input: TerminalCreateInput) => Promise<TerminalCatalogMutationResult>
  pruneTerminals: (repoRoot: string) => Promise<{ pruned: number; remaining: number }>
  listSessions: (input: { repoRoot: string }) => Promise<TerminalSlotSummary[]>
  /**
   * Open the underlying WebSocket (if not already open) and resolve
   * once it reaches the OPEN state. Used as a T1.2 prewarm when the
   * user enters a repo so they pay the DNS+TCP+TLS+WS handshake
   * before clicking a terminal view. Idempotent (already-open socket
   * resolves immediately) and best-effort (failures are swallowed;
   * the next real `listSessions`/`attach` will retry and surface a
   * real error if the server is unreachable). No parameters: the
   * bridge maintains a single shared socket, not per-repo sockets.
   */
  prewarm: () => Promise<void>
  /**
   * T5.1: force-reconnect if the socket is in a non-OPEN state.
   * Used as a recovery hook on `visibilitychange:visible` and
   * `pageshow` (bfcache) so a backgrounded mobile tab reconnects
   * without waiting for the 300ms backoff. No-op if the socket is
   * already healthy. Never force-closes a working socket.
   */
  kickReconnect: () => void
  getSlotSnapshot: (input: TerminalSlotSnapshotInput) => Promise<TerminalSlotSnapshot | null>
  notifyBell: (input: TerminalNotifyBellInput) => Promise<TerminalMutationResult>
  sendTestNotification: () => Promise<boolean>
  setBadge: (count: number) => void
  onOutput: (cb: (event: TerminalOutputEvent) => void) => () => void
  onTitle: (cb: (event: TerminalTitleEvent) => void) => () => void
  onExit: (cb: (event: TerminalExitEvent) => void) => () => void
  onIdentity: (cb: (event: TerminalIdentityViewModel) => void) => () => void
  onLifecycle: (cb: (event: TerminalLifecycleViewModel) => void) => () => void
  onSessionsChanged: (cb: (repoRoot: string) => void) => () => void
  /**
   * Subscribe to per-session close broadcasts from the server. Emitted
   * after a successful `close` IPC alongside the broader
   * `sessions-changed` event. The `TerminalSlotRegistry` uses this
   * to drop a stale local entry immediately, without waiting for the
   * next reconcile — the critical fix for the "open new terminal and
   * see the previous shell's `Restored session: …` line print twice"
   * bug, where a lost close request left the server PTY alive.
   */
  onSlotClosed: (cb: (event: { ptySessionId: string; repoRoot: string }) => void) => () => void
}

export interface ClientShellBridge {
  openSettingsWindow: (input?: { page?: SettingsPage }) => Promise<boolean>
  openExternalUrl: (input: { url: string; allowHttp?: boolean }) => Promise<ExecResult>
  openDirectoryDialog: (input?: { title?: string }) => Promise<string | null>
  consumeExternalOpenPaths: () => Promise<string[]>
  openInFinder: (input: { path: string }) => Promise<ExecResult>
}

export interface ClientBridge {
  kind(): ClientRuntimeKind
  hasCapability(capability: ClientNativeCapability): boolean
  getBootstrap(): ClientBootstrapSnapshot
  invokeIpc(request: IpcRequest): Promise<unknown>
  abortIpc(requestId: string): Promise<boolean>
  onIpcEvent(cb: (event: IpcEvent) => void): () => void
  onEffectIntent(cb: (event: ClientEffectIntent) => void): () => void
  pathForFile(file: File): string
  /**
   * Persist clipboard / drop file blobs to a runtime-resolved location and
   * return absolute paths the PTY can read. Electron writes under
   * `<os.tmpdir>/goblin-clipboard-<pid>/`; web POSTs multipart to
   * `/api/clipboard/files` and the server writes under
   * `<serverDataDir()>/clipboard-tmp-<pid>/`. Returns `[]` on any failure
   * so the resolver can count backend transfer failures separately from
   * unsafe path filtering.
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
  shell(): ClientShellBridge | null
  terminal(): ClientTerminalBridge
}
