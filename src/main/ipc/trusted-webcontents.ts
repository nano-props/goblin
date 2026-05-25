import type { IpcMainInvokeEvent, WebContents } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const trustedWebContentsIds = new Set<number>()
const trustedAppPaths = new Set<string>()

export function registerTrustedAppPath(filePath: string): void {
  trustedAppPaths.add(path.resolve(filePath))
}

export function registerTrustedWebContents(webContents: WebContents): void {
  trustedWebContentsIds.add(webContents.id)
  webContents.once('destroyed', () => {
    trustedWebContentsIds.delete(webContents.id)
  })
}

export function isTrustedAppUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol !== 'file:') return false
    return trustedAppPaths.has(path.resolve(fileURLToPath(url)))
  } catch {
    return false
  }
}

export function isTrustedIpcEvent(event: IpcMainInvokeEvent): boolean {
  return trustedWebContentsIds.has(event.sender.id) && event.senderFrame !== null && isTrustedAppUrl(event.senderFrame.url)
}
