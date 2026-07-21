import type { AppQuitDrainResult } from '#/shared/app-quit-drain.ts'
import type { IpcEvent, IpcRequest, SettingsPage } from '#/shared/api-types.ts'
import type { ClientEffectIntent } from '#/shared/client-effect-intents.ts'
import type { ExecResult } from '#/shared/git-types.ts'
import type {
  TerminalMutationResult,
  TerminalNotifyBellInput,
  TerminalTestNotificationInput,
} from '#/shared/terminal-types.ts'

/** The Electron preload surface available to the web client. */
export interface GoblinNativeBridge {
  invokeIpc: (request: IpcRequest) => Promise<unknown>
  abortIpc: (requestId: string) => Promise<boolean>
  notifyAppQuitDrained?: (result: AppQuitDrainResult) => Promise<boolean>
  onEvent: (cb: (event: IpcEvent) => void) => () => void
  onIntent?: (cb: (event: ClientEffectIntent) => void) => () => void
  pathForFile: (file: File) => string
  host?: {
    openSettingsWindow: (input?: { page?: SettingsPage }) => Promise<boolean>
    openExternalUrl: (input: { url: string; allowHttp?: boolean }) => Promise<ExecResult>
    openDirectoryDialog: (input?: { title?: string }) => Promise<string | null>
    consumeExternalOpenPaths: () => Promise<string[]>
  }
  terminal: {
    notifyBell?: (input: TerminalNotifyBellInput) => Promise<TerminalMutationResult>
    sendTestNotification?: (input: TerminalTestNotificationInput) => Promise<boolean>
    setBadge?: (count: number) => void
  }
  saveClipboardFiles: (files: File[]) => Promise<string[]>
  rotateAccessToken?: () => Promise<{ accessToken: string }>
}
