import { execa } from 'execa'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

const VSCODE_BUNDLE_ID = 'com.microsoft.VSCode'
const OPEN_TIMEOUT_MS = 10_000

/** Main probes on demand; the current renderer UI asks once per mounted
 *  branch action area, so runtime install/removal may need a remount or
 *  app restart before buttons update. */
export function isVSCodeInstalled(): Promise<boolean> {
  const VSCODE_APP_CANDIDATES = [
    path.join(app.getPath('home'), 'Applications/Visual Studio Code.app'),
    '/Applications/Visual Studio Code.app',
  ]
  if (VSCODE_APP_CANDIDATES.some((p) => existsSync(p))) return Promise.resolve(true)

  return execa('/usr/bin/mdfind', [`kMDItemCFBundleIdentifier == '${VSCODE_BUNDLE_ID}'`], {
    timeout: 1000,
    forceKillAfterDelay: 500,
    reject: false,
  }).then((result) => !result.failed && (result.stdout?.trim().length ?? 0) > 0)
}

function isUsableDirectory(p: string): boolean {
  if (!path.isAbsolute(p) || p.includes('\0')) return false
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

export function openInVSCode(p: string): Promise<{ ok: boolean; message: string }> {
  if (!isUsableDirectory(p)) return Promise.resolve({ ok: false, message: 'error.invalid-path' })

  return execa('/usr/bin/open', ['-b', VSCODE_BUNDLE_ID, p], {
    timeout: OPEN_TIMEOUT_MS,
    forceKillAfterDelay: 500,
    reject: false,
  }).then((result) => {
    if (result.failed) {
      const message = result.stderr?.trim() || result.shortMessage || result.message || 'error.vscode-not-installed'
      return {
        ok: false,
        message: /Unable to find application/i.test(message) ? 'error.vscode-not-installed' : message,
      }
    }
    return { ok: true, message: p }
  })
}
