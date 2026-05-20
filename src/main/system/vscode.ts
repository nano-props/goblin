import { execFile } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

const VSCODE_BUNDLE_ID = 'com.microsoft.VSCode'

export function isVSCodeInstalled(): Promise<boolean> {
  const VSCODE_APP_CANDIDATES = [
    path.join(app.getPath('home'), 'Applications/Visual Studio Code.app'),
    '/Applications/Visual Studio Code.app',
  ]
  if (VSCODE_APP_CANDIDATES.some((p) => existsSync(p))) return Promise.resolve(true)

  return new Promise((resolve) => {
    execFile(
      '/usr/bin/mdfind',
      [`kMDItemCFBundleIdentifier == '${VSCODE_BUNDLE_ID}'`],
      { timeout: 1000 },
      (err, stdout) => {
        resolve(!err && stdout.trim().length > 0)
      },
    )
  })
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
  if (!isUsableDirectory(p)) return Promise.resolve({ ok: false, message: 'error.invalidPath' })

  return new Promise((resolve) => {
    execFile('/usr/bin/open', ['-b', VSCODE_BUNDLE_ID, p], (err, _stdout, stderr) => {
      if (err) {
        const message = stderr.trim() || err.message
        resolve({
          ok: false,
          message: /Unable to find application/i.test(message) ? 'error.vscodeNotInstalled' : message,
        })
        return
      }
      resolve({ ok: true, message: p })
    })
  })
}
