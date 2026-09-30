import type { ClientBootstrapSnapshot } from '#/shared/bootstrap.ts'
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
  TerminalResizeResult,
  TerminalRestartInput,
  TerminalRestartResult,
  TerminalSessionClosedEvent,
  TerminalTakeoverInput,
  TerminalTakeoverResult,
  TerminalTestNotificationInput,
  TerminalTitleEvent,
  TerminalWriteInput,
  TerminalWriteResult,
  TerminalSessionsSnapshot,
  TerminalSessionsChangedEvent,
} from '#/shared/terminal-types.ts'
import type {
  WorkspacePaneTabsChangedRealtimeMessage,
  WorkspacePaneTabsListInput,
  WorkspacePaneTabsSnapshot,
  WorkspacePaneTabsUpdateInput,
  WorkspacePaneTabsWriteResult,
} from '#/shared/workspace-pane-tabs.ts'
import type {
  WorkspacePaneRuntimeCloseInput,
  WorkspacePaneRuntimeCloseResult,
  WorkspacePaneRuntimeOpenInput,
  WorkspacePaneRuntimeOpenResult,
} from '#/shared/workspace-pane-runtime.ts'
import type { TerminalIdentityRealtimeEvent, TerminalLifecycleRealtimeEvent } from '#/web/terminal/projection-types.ts'

export interface ClientTerminal {
  attach: (input: TerminalAttachInput) => Promise<TerminalAttachResult>
  restart: (input: TerminalRestartInput) => Promise<TerminalRestartResult>
  write: (input: TerminalWriteInput) => Promise<TerminalWriteResult>
  resize: (input: TerminalResizeInput) => Promise<TerminalResizeResult>
  takeover: (input: TerminalTakeoverInput) => Promise<TerminalTakeoverResult>
  recoverSessions: (input: TerminalListSessionsInput) => Promise<TerminalSessionsSnapshot>
  notifyBell: (input: TerminalNotifyBellInput) => Promise<TerminalMutationResult>
  sendTestNotification: (input: TerminalTestNotificationInput) => Promise<boolean>
  onOutput: (cb: (event: TerminalOutputEvent) => void) => () => void
  onBell: (cb: (event: TerminalBellRealtimeEvent) => void) => () => void
  onTitle: (cb: (event: TerminalTitleEvent) => void) => () => void
  onExit: (cb: (event: TerminalExitEvent) => void) => () => void
  onIdentity: (cb: (event: TerminalIdentityRealtimeEvent) => void) => () => void
  onLifecycle: (cb: (event: TerminalLifecycleRealtimeEvent) => void) => () => void
  onSessionsChanged: (cb: (event: TerminalSessionsChangedEvent) => void) => () => void
  /** Subscribe to authoritative per-session close broadcasts. */
  onSessionClosed: (cb: (event: TerminalSessionClosedEvent) => void) => () => void
}

export interface ClientWorkspacePaneTabs {
  list: (input: WorkspacePaneTabsListInput) => Promise<WorkspacePaneTabsSnapshot>
  update: (input: WorkspacePaneTabsUpdateInput) => Promise<WorkspacePaneTabsWriteResult>
  onChanged: (cb: (message: WorkspacePaneTabsChangedRealtimeMessage) => void) => () => void
}

export interface ClientWorkspacePaneRuntime {
  open: (input: WorkspacePaneRuntimeOpenInput) => Promise<WorkspacePaneRuntimeOpenResult>
  close: (input: WorkspacePaneRuntimeCloseInput) => Promise<WorkspacePaneRuntimeCloseResult>
}

export interface ClientAppRealtimeLifecycle {
  /** Probe reconnection for the shared realtime transport. */
  kickReconnect: () => void
  onRecovered: (cb: (clientId: string) => void) => () => void
}

export interface ClientBridge {
  getBootstrap(): ClientBootstrapSnapshot
  /** Persist clipboard blobs and return one readable absolute path per input file. */
  saveClipboardFiles(files: File[]): Promise<string[]>
  appRealtime(): ClientAppRealtimeLifecycle
  terminal(): ClientTerminal
  workspacePaneTabs(): ClientWorkspacePaneTabs
  workspacePaneRuntime(): ClientWorkspacePaneRuntime
}
