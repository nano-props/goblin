import { execa } from 'execa'
import { existsSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ghosttyNodeLog } from '#/node/logger.ts'
import { buildRemoteTerminalInvocation } from '#/system/remote-terminal.ts'

const GHOSTTY_BUNDLE_ID = 'com.mitchellh.ghostty'
const APPLE_SCRIPT_TIMEOUT_MS = 5_000
const OPEN_TIMEOUT_MS = 10_000

/** Whether Ghostty.app exists in either of the two locations macOS users
 *  install GUI apps to. Main probes on demand; the current client UI
 *  asks once per mounted branch action area, so runtime install/removal
 *  may need a remount or app restart before buttons update. */
export function isGhosttyInstalled(): boolean {
  const candidates = [path.join(os.homedir(), 'Applications/Ghostty.app'), '/Applications/Ghostty.app']
  return candidates.some((p) => existsSync(p))
}

function isUsableDirectory(p: string): boolean {
  if (!path.isAbsolute(p) || p.includes('\0')) return false
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

// Opens a new window in an already-running Ghostty instance, setting the
// initial working directory via Ghostty's scripting dictionary (see
// ghostty/macos/Ghostty.sdef). `dir` is passed as argv, not interpolated,
// so escaping isn't a concern. No explicit `activate`: Ghostty's `new
// window` handler already does that internally, and an extra call here
// would pull focus to the wrong Space (ghostty-org/ghostty#11457).
const NEW_WINDOW_SCRIPT = `
  on run argv
    set dir to item 1 of argv
    tell application "System Events"
      set ghosttyIsRunning to exists (first process whose bundle identifier is "${GHOSTTY_BUNDLE_ID}")
    end tell
    if not ghosttyIsRunning then return "not-running"
    tell application id "${GHOSTTY_BUNDLE_ID}"
      new window with configuration {initial working directory:dir}
    end tell
    return "opened"
  end run
`

// Same shape as NEW_WINDOW_SCRIPT, but for SSH: start Ghostty's surface
// with the SSH command directly. Do not use `initial input` here: it
// visibly types the shell-quoted command into the user's shell before
// connecting.
const REMOTE_NEW_WINDOW_SCRIPT = `
  on run argv
    set commandText to item 1 of argv
    tell application "System Events"
      set ghosttyIsRunning to exists (first process whose bundle identifier is "${GHOSTTY_BUNDLE_ID}")
    end tell
    if not ghosttyIsRunning then return "not-running"
    tell application id "${GHOSTTY_BUNDLE_ID}"
      new window with configuration {command:commandText}
    end tell
    return "opened"
  end run
`

/** Run an inline AppleScript via `osascript`, passing `args` as argv
 *  rather than interpolating them, and return trimmed stdout. */
function runOsascript(script: string, args: string[]): Promise<string> {
  return execa('/usr/bin/osascript', ['-e', script, ...args], {
    timeout: APPLE_SCRIPT_TIMEOUT_MS,
    forceKillAfterDelay: 500,
  }).then(({ stdout }) => stdout.trim())
}

/** Launch Ghostty via Launch Services, forwarding `args` as argv. Ghostty
 *  only ever reads argv once, at process init (`ghostty_init` in
 *  `macos/Sources/App/macOS/main.swift`) — a running instance has no
 *  code path that re-reads it on activation.
 *
 *  Deliberately omits `-n` (force new instance): if the warm path above
 *  failed only because the liveness check itself failed — not because
 *  Ghostty is actually down — `-n` would spawn a genuinely separate
 *  second instance/window on top of the existing one. Without `-n`,
 *  `open` routes to an already-running instance and just activates it
 *  instead (args get dropped, since nothing re-reads them, but nothing
 *  duplicates either); when Ghostty truly isn't running, it behaves
 *  identically to `-n` since there's no instance to route to.
 *
 *  Spawned children are detached + unref'd so quitting Goblin doesn't
 *  bring the terminal down with it. */
async function launchOrActivateGhostty(args: string[]): Promise<void> {
  const child = execa('open', ['-a', 'Ghostty.app', '--args', ...args], {
    detached: true,
    stdio: 'ignore',
    cleanup: false,
    timeout: OPEN_TIMEOUT_MS,
    forceKillAfterDelay: 500,
  })
  child.unref()
  await child
}

/** Try the warm (already-running) path via `warmScript` first, falling
 *  back to `launchOrActivateGhostty` on any failure — including a
 *  failed/timed-out liveness check, which looks identical to a real
 *  failure here. Shared by `openInGhostty` and `openRemoteInGhostty`;
 *  only the script and argv differ between the two. */
async function openGhosttyWindow(options: {
  kind: 'local' | 'remote'
  warmScript: string
  warmArgs: string[]
  coldArgs: string[]
  successMessage: string
}): Promise<{ ok: boolean; message: string }> {
  try {
    const stdout = await runOsascript(options.warmScript, options.warmArgs)
    if (stdout === 'opened') return { ok: true, message: options.successMessage }
  } catch (err) {
    ghosttyNodeLog.warn({ err, kind: options.kind }, 'AppleScript open failed, falling back to launch')
  }

  try {
    await launchOrActivateGhostty(options.coldArgs)
    return { ok: true, message: options.successMessage }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

/** Open `p` in Ghostty, reusing a running instance when possible and
 *  cold-starting one otherwise. See `openGhosttyWindow` for how the two
 *  paths are chosen. */
export async function openInGhostty(p: string): Promise<{ ok: boolean; message: string }> {
  if (!isUsableDirectory(p)) return { ok: false, message: 'error.invalid-path' }
  if (!isGhosttyInstalled()) return { ok: false, message: 'error.ghostty-not-installed' }

  return openGhosttyWindow({
    kind: 'local',
    warmScript: NEW_WINDOW_SCRIPT,
    warmArgs: [p],
    coldArgs: [`--working-directory=${p}`],
    successMessage: p,
  })
}

/** Open an SSH session in a new Ghostty window. Mirrors `openInGhostty`
 *  via the same `openGhosttyWindow` orchestration: the warm path uses
 *  Ghostty's AppleScript `command` surface configuration, while cold start
 *  uses `-e ssh ...` so Ghostty spawns the SSH session directly. */
export async function openRemoteInGhostty(
  alias: string,
  remotePath: string,
): Promise<{ ok: boolean; message: string }> {
  const invocation = buildRemoteTerminalInvocation(alias, remotePath)
  if (!invocation) return { ok: false, message: 'error.invalid-arguments' }
  if (!isGhosttyInstalled()) return { ok: false, message: 'error.ghostty-not-installed' }

  return openGhosttyWindow({
    kind: 'remote',
    warmScript: REMOTE_NEW_WINDOW_SCRIPT,
    warmArgs: [invocation.shellCommand],
    coldArgs: ['-e', invocation.command, ...invocation.args],
    successMessage: remotePath,
  })
}
