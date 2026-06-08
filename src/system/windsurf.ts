import { hasAppCli, openByAppCli, openRemoteByAppCli } from '#/system/open-app.ts'

const APP_NAME = 'Windsurf'
const CLI_NAME = 'windsurf'

export function isWindsurfInstalled(): boolean {
  return hasAppCli(APP_NAME, CLI_NAME)
}

export function openInWindsurf(p: string): Promise<{ ok: boolean; message: string }> {
  return openByAppCli(APP_NAME, CLI_NAME, p)
}

export function openRemoteInWindsurf(alias: string, remotePath: string): Promise<{ ok: boolean; message: string }> {
  return openRemoteByAppCli(APP_NAME, CLI_NAME, alias, remotePath)
}
