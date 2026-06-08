import { hasAppCli, openByAppCli, openRemoteByAppCli } from '#/system/open-app.ts'

const APP_NAME = 'Cursor'
const CLI_NAME = 'cursor'

export function isCursorInstalled(): boolean {
  return hasAppCli(APP_NAME, CLI_NAME)
}

export function openInCursor(p: string): Promise<{ ok: boolean; message: string }> {
  return openByAppCli(APP_NAME, CLI_NAME, p)
}

export function openRemoteInCursor(alias: string, remotePath: string): Promise<{ ok: boolean; message: string }> {
  return openRemoteByAppCli(APP_NAME, CLI_NAME, alias, remotePath)
}
