import type { ClientBootstrapSnapshot, ClientNativeCapability, ClientRuntimeKind } from '#/shared/bootstrap.ts'
import type { IpcEvent, IpcRequest, SettingsPage } from '#/shared/api-types.ts'
import type { ClientEffectIntent } from '#/shared/client-effect-intents.ts'
import type { ExecResult } from '#/shared/git-types.ts'
import type {
  TerminalAttachInput,
  TerminalAttachResult,
  TerminalBellRealtimeEvent,
  TerminalExitEvent,
  TerminalListSessionsInput,
  TerminalMutationResult,
  TerminalNotifyBellInput,
  TerminalOutputEvent,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalRestartResult,
  TerminalSessionInput,
  TerminalTakeoverInput,
  TerminalTakeoverResult,
  TerminalTestNotificationInput,
  TerminalTitleEvent,
  TerminalWriteInput,
  TerminalWriteResult,
  TerminalSessionsRecoveryResult,
} from '#/shared/terminal-types.ts'
import type {
  WorkspacePaneTabsListInput,
  WorkspacePaneTabsReplaceInput,
  WorkspacePaneTabsSnapshot,
  WorkspacePaneTabsUpdateInput,
} from '#/shared/workspace-pane-tabs.ts'
import type {
  WorkspacePaneRuntimeCloseInput,
  WorkspacePaneRuntimeCloseResult,
  WorkspacePaneRuntimeOpenInput,
  WorkspacePaneRuntimeOpenResult,
} from '#/shared/workspace-pane-runtime.ts'
import type { TerminalIdentityRealtimeEvent, TerminalLifecycleRealtimeEvent } from '#/web/components/terminal/types.ts'

export interface ClientTerminal {
  attach: (input: TerminalAttachInput) => Promise<TerminalAttachResult>
  restart: (input: TerminalRestartInput) => Promise<TerminalRestartResult>
  write: (input: TerminalWriteInput) => Promise<TerminalWriteResult>
  resize: (input: TerminalResizeInput) => Promise<TerminalMutationResult>
  takeover: (input: TerminalTakeoverInput) => Promise<TerminalTakeoverResult>
  pruneTerminals: (repoRoot: string, repoRuntimeId: string) => Promise<{ pruned: number; remaining: number }>
  recoverSessions: (input: TerminalListSessionsInput) => Promise<TerminalSessionsRecoveryResult>
  notifyBell: (input: TerminalNotifyBellInput) => Promise<TerminalMutationResult>
  sendTestNotification: (input: TerminalTestNotificationInput) => Promise<boolean>
  setBadge: (count: number) => void
  onOutput: (cb: (event: TerminalOutputEvent) => void) => () => void
  onBell: (cb: (event: TerminalBellRealtimeEvent) => void) => () => void
  onTitle: (cb: (event: TerminalTitleEvent) => void) => () => void
  onExit: (cb: (event: TerminalExitEvent) => void) => () => void
  onIdentity: (cb: (event: TerminalIdentityRealtimeEvent) => void) => () => void
  onLifecycle: (cb: (event: TerminalLifecycleRealtimeEvent) => void) => () => void
  onSessionsChanged: (cb: (repoRoot: string) => void) => () => void
  /**
   * Subscribe to per-session close broadcasts from the server. Emitted
   * after a successful `close` IPC alongside the broader
   * `sessions-changed` event. The `TerminalSessionProjection` uses this
   * to drop a stale local entry immediately, without waiting for the
   * next reconcile — the critical fix for the "open new terminal and
   * see the previous shell's `Restored session: …` line print twice"
   * bug, where a lost close request left the server PTY alive.
   */
  onSessionClosed: (
    cb: (event: {
      terminalRuntimeSessionId: string
      terminalRuntimeGeneration: number
      terminalSessionId: string
      repoRoot: string
      worktreePath: string
    }) => void,
  ) => () => void
}

export interface ClientWorkspacePaneTabs {
  list: (input: WorkspacePaneTabsListInput) => Promise<WorkspacePaneTabsSnapshot>
  replace: (input: WorkspacePaneTabsReplaceInput) => Promise<WorkspacePaneTabsSnapshot>
  update: (input: WorkspacePaneTabsUpdateInput) => Promise<WorkspacePaneTabsSnapshot>
  onChanged: (cb: (repoRoot: string) => void) => () => void
}

export interface ClientWorkspacePaneRuntime {
  open: (input: WorkspacePaneRuntimeOpenInput) => Promise<WorkspacePaneRuntimeOpenResult>
  close: (input: WorkspacePaneRuntimeCloseInput) => Promise<WorkspacePaneRuntimeCloseResult>
}

export interface ClientAppRealtimeLifecycle {
  /**
   * Force/probe reconnect for the shared app realtime WebSocket. Used by the
   * app runtime projection owner on browser visibility recovery.
   */
  kickReconnect: () => void
  onRecovered: (cb: (clientId: string) => void) => () => void
}

export interface ClientHostBridge {
  openSettingsWindow: (input?: { page?: SettingsPage }) => Promise<boolean>
  openExternalUrl: (input: { url: string; allowHttp?: boolean }) => Promise<ExecResult>
  openDirectoryDialog: (input?: { title?: string }) => Promise<string | null>
  consumeExternalOpenPaths: () => Promise<string[]>
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
   * client surfaces the new value in the Web settings page so
   * the user can re-authenticate. Throws (via the IPC reject path)
   * when called from a non-Electron runtime; the Web settings page
   * gates the rotation button on `kind() === 'electron'`.
   */
  rotateAccessToken?(): Promise<{ accessToken: string }>
  host(): ClientHostBridge | null
  appRealtime(): ClientAppRealtimeLifecycle
  terminal(): ClientTerminal
  workspacePaneTabs(): ClientWorkspacePaneTabs
  workspacePaneRuntime(): ClientWorkspacePaneRuntime
}
