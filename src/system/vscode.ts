import { hasAppCli, openByAppCli } from '#/system/open-app.ts'

const APP_NAME = 'Visual Studio Code'
const CLI_NAME = 'code'

export function isVSCodeInstalled(): boolean {
  return hasAppCli(APP_NAME, CLI_NAME)
}

export function openInVSCode(p: string): Promise<{ ok: boolean; message: string }> {
  return openByAppCli(APP_NAME, CLI_NAME, p)
}
