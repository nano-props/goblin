// Shared utilities for opening a directory in a macOS .app.
//
// VS Code-family editors (VS Code, Cursor, Windsurf) ship a CLI binary
// inside their .app bundle at Contents/Resources/app/bin/<name>. Using
// this CLI is more reliable than `open -a` because the CLI talks to the
// editor's IPC channel directly, whereas `open -a` just activates the
// app and newer hub/home UIs may ignore the directory argument.

import { execa } from 'execa'
import { existsSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isSafeRemoteAbsolutePath, isSafeRemoteAlias } from '#/system/remote-shell.ts'

const OPEN_TIMEOUT_MS = 10_000

function isUsableDirectory(p: string): boolean {
  if (!path.isAbsolute(p) || p.includes('\0')) return false
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** Standard macOS install locations for a .app bundle. */
export function appCandidates(appName: string): string[] {
  return [path.join(os.homedir(), `Applications/${appName}.app`), `/Applications/${appName}.app`]
}

/** Find the first existing .app bundle path for `appName`, or null. */
function resolveAppPath(appName: string): string | null {
  return appCandidates(appName).find((p) => existsSync(p)) ?? null
}

/** Resolve the CLI binary inside a VS Code-family .app bundle.
 *  Returns null if the binary doesn't exist. */
function resolveAppCli(appName: string, cliName: string): string | null {
  const appPath = resolveAppPath(appName)
  if (!appPath) return null
  const cli = path.join(appPath, 'Contents/Resources/app/bin', cliName)
  return existsSync(cli) ? cli : null
}

export function hasAppCli(appName: string, cliName: string): boolean {
  return resolveAppCli(appName, cliName) !== null
}

/** Open `dir` using the CLI binary inside a VS Code-family .app bundle.
 *  Returns an error if the CLI binary isn't found — `open -a` is not
 *  used as a fallback because newer editor UIs (e.g. Cursor's Home)
 *  silently ignore the directory argument passed via Launch Services. */
export function openByAppCli(appName: string, cliName: string, dir: string): Promise<{ ok: boolean; message: string }> {
  if (!isUsableDirectory(dir)) return Promise.resolve({ ok: false, message: 'error.invalid-path' })

  const cli = resolveAppCli(appName, cliName)
  if (!cli) return Promise.resolve({ ok: false, message: 'error.editor-not-installed' })

  return execa(cli, [dir], {
    timeout: OPEN_TIMEOUT_MS,
    forceKillAfterDelay: 500,
    reject: false,
  }).then((result) => {
    if (result.failed) {
      const message = result.stderr?.trim() || result.shortMessage || result.message || 'error.editor-not-installed'
      return { ok: false, message }
    }
    return { ok: true, message: dir }
  })
}

/** Open a remote SSH workspace in a VS Code-family editor.
 *
 *  The editor CLIs accept `--remote ssh-remote+<alias> <path>`, where
 *  `<path>` is interpreted as a path on the remote host. The alias and
 *  path are passed as argv so they don't go through a shell — the safety
 *  checks in `remote-shell` only stop obviously malicious input from
 *  reaching the editor's own argument parser. */
export function openRemoteByAppCli(
  appName: string,
  cliName: string,
  alias: string,
  remotePath: string,
): Promise<{ ok: boolean; message: string }> {
  if (!isSafeRemoteAlias(alias) || !isSafeRemoteAbsolutePath(remotePath)) {
    return Promise.resolve({ ok: false, message: 'error.invalid-arguments' })
  }

  const cli = resolveAppCli(appName, cliName)
  if (!cli) return Promise.resolve({ ok: false, message: 'error.editor-not-installed' })

  return execa(cli, ['--remote', `ssh-remote+${alias}`, remotePath], {
    timeout: OPEN_TIMEOUT_MS,
    forceKillAfterDelay: 500,
    reject: false,
  }).then((result) => {
    if (result.failed) {
      const message =
        result.stderr?.trim() || result.shortMessage || result.message || 'error.remote-editor-not-supported'
      return { ok: false, message }
    }
    return { ok: true, message: remotePath }
  })
}
