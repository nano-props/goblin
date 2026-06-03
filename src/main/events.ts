import type { BrowserWindow } from 'electron'
import type { RpcEvent } from '#/shared/rpc.ts'
import type { RepoQueryInvalidationEvent } from '#/shared/repo-query-invalidation.ts'
import { broadcastToSurfaceCapability, sendToRegisteredWindow } from '#/main/window-registry.ts'
import { RPC_EVENT_CHANNEL } from '#/shared/ipc-channels.ts'

export function broadcastRpcEvent(event: RpcEvent): void {
  broadcastToSurfaceCapability('rpcBroadcast', RPC_EVENT_CHANNEL, [event])
}

export function sendRpcEvent(win: BrowserWindow | null | undefined, event: RpcEvent): void {
  sendToRegisteredWindow(win, RPC_EVENT_CHANNEL, [event])
}

export function broadcastRepoQueryInvalidation(event: Omit<RepoQueryInvalidationEvent, 'type'>): void {
  broadcastRpcEvent({ type: 'repo-query-invalidated', ...event })
}
