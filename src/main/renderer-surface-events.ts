import type { BrowserWindow } from 'electron'
import type { IpcEvent } from '#/shared/api-types.ts'
import type { RepoQueryInvalidationEvent } from '#/shared/repo-query-invalidation.ts'
import type { RendererEffectIntent } from '#/shared/renderer-effect-intents.ts'
import { broadcastToSurfaceCapability, sendToRegisteredWindow } from '#/main/window-registry.ts'
import { RENDERER_EFFECT_INTENT_CHANNEL, IPC_EVENT_CHANNEL } from '#/shared/ipc-channels.ts'

// Native-host downstream messages into trusted renderer surfaces. Server-owned
// realtime (terminal + invalidation) continues to flow over /ws instead.
export function broadcastIpcEvent(event: IpcEvent): void {
  broadcastToSurfaceCapability('ipcBroadcast', IPC_EVENT_CHANNEL, [event])
}

export function sendIpcEvent(win: BrowserWindow | null | undefined, event: IpcEvent): void {
  sendToRegisteredWindow(win, IPC_EVENT_CHANNEL, [event])
}

export function broadcastRendererEffectIntent(intent: RendererEffectIntent): void {
  broadcastToSurfaceCapability('ipcBroadcast', RENDERER_EFFECT_INTENT_CHANNEL, [intent])
}

export function sendRendererEffectIntent(win: BrowserWindow | null | undefined, intent: RendererEffectIntent): void {
  sendToRegisteredWindow(win, RENDERER_EFFECT_INTENT_CHANNEL, [intent])
}

export function broadcastRepoQueryInvalidation(event: Omit<RepoQueryInvalidationEvent, 'type'>): void {
  broadcastIpcEvent({ type: 'repo-query-invalidated', ...event })
}
