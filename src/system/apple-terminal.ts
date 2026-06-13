import { execa } from 'execa'
import { statSync } from 'node:fs'
import path from 'node:path'
import { buildRemoteTerminalInvocation } from '#/system/remote-terminal.ts'

const OPEN_TIMEOUT_MS = 10_000
export const TERMINAL_APP_CANDIDATES = [
  '/System/Applications/Utilities/Terminal.app',
  '/Applications/Utilities/Terminal.app',
]

function isUsableDirectory(p: string): boolean {
  if (!path.isAbsolute(p) || p.includes('\0')) return false
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** Open `dir` in macOS Terminal.app.
 *
 *  `open -a Terminal <dir>` tells macOS to open a new Terminal window
 *  with its working directory set to `dir`. Works whether Terminal is
 *  already running or not — the path is passed as a native argument,
 *  so there are no escaping or injection concerns. */
export async function openInAppleTerminal(p: string): Promise<{ ok: boolean; message: string }> {
  if (!isUsableDirectory(p)) return { ok: false, message: 'error.invalid-path' }

  try {
    await execa('open', ['-a', 'Terminal', p], {
      timeout: OPEN_TIMEOUT_MS,
      forceKillAfterDelay: 500,
    })
    return { ok: true, message: p }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

/** Open an SSH session in a new macOS Terminal.app window.
 *
 *  We drive `osascript` with a fully shell-quoted command string so
 *  Terminal.app renders the SSH invocation verbatim. Terminal.app then
 *  drops the user into the remote worktree after `cd` runs on the
 *  remote host. */
export async function openRemoteInAppleTerminal(
  alias: string,
  remotePath: string,
): Promise<{ ok: boolean; message: string }> {
  const invocation = buildRemoteTerminalInvocation(alias, remotePath)
  if (!invocation) return { ok: false, message: 'error.invalid-arguments' }

  const script = `
    on run argv
      set commandText to item 1 of argv
      tell application "Terminal"
        activate
        do script commandText
      end tell
    end run
  `

  try {
    await execa('/usr/bin/osascript', ['-e', script, invocation.shellCommand], {
      timeout: OPEN_TIMEOUT_MS,
      forceKillAfterDelay: 500,
    })
    return { ok: true, message: remotePath }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

export function hasAppleTerminalAtKnownPaths(candidates: readonly string[] = TERMINAL_APP_CANDIDATES): boolean {
  return candidates.some((candidate) => isUsableDirectory(candidate))
}

export async function isAppleTerminalInstalled(_signal?: AbortSignal): Promise<boolean> {
  return hasAppleTerminalAtKnownPaths()
}
