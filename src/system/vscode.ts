import { hasAppCli, openByAppCli, openRemoteByAppCli } from '#/system/open-app.ts'

const APP_NAME = 'Visual Studio Code'
const CLI_NAME = 'code'

export function isVSCodeInstalled(): boolean {
  return hasAppCli(APP_NAME, CLI_NAME)
}

export function openInVSCode(p: string): Promise<{ ok: boolean; message: string }> {
  return openByAppCli(APP_NAME, CLI_NAME, p)
}

export function openRemoteInVSCode(alias: string, remotePath: string): Promise<{ ok: boolean; message: string }> {
  return openRemoteByAppCli(APP_NAME, CLI_NAME, alias, remotePath)
}
