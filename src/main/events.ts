import { BrowserWindow } from 'electron'
import type { RpcEvent } from '#/shared/rpc.ts'

export function broadcastRpcEvent(event: RpcEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    sendToWindow(win, event)
  }
}

export function sendRpcEvent(win: BrowserWindow | null | undefined, event: RpcEvent): void {
  if (!win) return
  sendToWindow(win, event)
}

function sendToWindow(win: BrowserWindow, event: RpcEvent): void {
  try {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('goblin:event', event)
  } catch (err) {
    console.warn('[events] failed to send RPC event', err)
  }
}
