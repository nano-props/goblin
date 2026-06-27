import type { BrowserWindow } from 'electron'
import type { IpcEvent } from '#/shared/api-types.ts'
import type { RepoQueryInvalidationEvent } from '#/shared/repo-query-invalidation.ts'
import type { ClientEffectIntent } from '#/shared/client-effect-intents.ts'
import { broadcastToSurfaceCapability, sendToRegisteredWindow } from '#/main/client-surface-registry.ts'
import { CLIENT_EFFECT_INTENT_CHANNEL, HOST_IPC_EVENT_CHANNEL } from '#/shared/ipc-channels.ts'

// Native-host downstream messages into trusted client surfaces. Server-owned
// realtime (terminal + invalidation) continues to flow over /ws instead.
export function broadcastIpcEvent(event: IpcEvent): void {
  broadcastToSurfaceCapability('ipcBroadcast', HOST_IPC_EVENT_CHANNEL, [event])
}

export function sendIpcEvent(win: BrowserWindow | null | undefined, event: IpcEvent): void {
  sendToRegisteredWindow(win, HOST_IPC_EVENT_CHANNEL, [event])
}

export function broadcastClientEffectIntent(intent: ClientEffectIntent): void {
  broadcastToSurfaceCapability('ipcBroadcast', CLIENT_EFFECT_INTENT_CHANNEL, [intent])
}

export function sendClientEffectIntent(win: BrowserWindow | null | undefined, intent: ClientEffectIntent): void {
  sendToRegisteredWindow(win, CLIENT_EFFECT_INTENT_CHANNEL, [intent])
}

export function broadcastRepoQueryInvalidation(event: Omit<RepoQueryInvalidationEvent, 'type'>): void {
  broadcastIpcEvent({ type: 'repo-query-invalidated', ...event })
}
