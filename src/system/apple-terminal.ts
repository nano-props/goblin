import { execa } from 'execa'
import { statSync } from 'node:fs'
import path from 'node:path'
import { buildRemoteTerminalInvocation, type RemoteTerminalInvocation } from '#/system/remote-terminal.ts'
import { shellQuote } from '#/system/remote-shell.ts'

const OPEN_TIMEOUT_MS = 10_000
const CLEAR_SCREEN_AND_SCROLLBACK = '\\033[H\\033[2J\\033[3J'
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

function appleTerminalRemoteCommand(invocation: RemoteTerminalInvocation): string {
  // Terminal.app `do script` starts a local shell first, so clear its visible bootstrap and scrollback.
  return `printf '${CLEAR_SCREEN_AND_SCROLLBACK}'; exec ${invocation.command} ${invocation.args.map(shellQuote).join(' ')}`
}

/** Open an SSH session in a new macOS Terminal.app window.
 *
 *  Terminal.app only accepts a shell string through AppleScript `do script`,
 *  so the argv invocation is encoded for the local shell. The printf prefix
 *  clears both the visible screen and scrollback after Terminal's local shell
 *  has started, then `exec` lets SSH take over the tab. */
export async function openRemoteInAppleTerminal(
  alias: string,
  remotePath: string,
): Promise<{ ok: boolean; message: string }> {
  const invocation = buildRemoteTerminalInvocation(alias, remotePath)
  if (!invocation) return { ok: false, message: 'error.invalid-arguments' }
  const commandText = appleTerminalRemoteCommand(invocation)
  const titleText = `${alias}:${remotePath}`

  const script = `
    on run argv
      set commandText to item 1 of argv
      set titleText to item 2 of argv
      set terminalWasRunning to application "Terminal" is running
      tell application "Terminal"
        if not terminalWasRunning then launch
        set remoteTab to do script commandText
        activate
        try
          set custom title of remoteTab to titleText
        end try
      end tell
    end run
  `

  try {
    await execa('/usr/bin/osascript', ['-e', script, commandText, titleText], {
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
