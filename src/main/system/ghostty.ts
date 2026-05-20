import { app } from 'electron'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { spawn, execFile } from 'node:child_process'

const GHOSTTY_BUNDLE_ID = 'com.mitchellh.ghostty'

/** Whether Ghostty.app exists in either of the two locations macOS users
 *  install GUI apps to. Probed on demand (not cached) so installing or
 *  removing Ghostty while Goblin is running takes effect immediately —
 *  cheap enough that an `existsSync` per call is fine. */
export function isGhosttyInstalled(): boolean {
  const candidates = [path.join(app.getPath('home'), 'Applications/Ghostty.app'), '/Applications/Ghostty.app']
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

/** Open `dir` as a new window if Ghostty is already running,
 *  setting the initial working directory via Ghostty's scripting
 *  dictionary (see ghostty/macos/Ghostty.sdef). */
function openInRunningGhostty(dir: string): Promise<boolean> {
  // The path is passed as argv (item 1 of argv), not interpolated,
  // so AppleScript string-escaping isn't a concern. We deliberately
  // don't call `activate` here — Ghostty's `new window` handler
  // already runs NSApp.activate internally (TerminalController.swift),
  // and an extra activate makes macOS pull the user to whichever
  // Space already has a Ghostty window. See ghostty-org/ghostty#11457.
  const script = `
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
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/osascript', ['-e', script, dir], (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message))
      resolve(stdout.trim() === 'opened')
    })
  })
}

// Open the given directory in Ghostty.
//
// If Ghostty is already running, we drive its AppleScript dictionary
// (com.mitchellh.ghostty) to open a new window in the existing
// instance, passing an inline `surface configuration` record with
// `initial working directory` set (see Ghostty.sdef). This avoids
// spawning a second Ghostty.app process every time.
//
// If Ghostty isn't running, fall back to `open -na Ghostty.app
// --args --working-directory=<path>`. The cold-start path can't
// use AppleScript (no process to talk to) and Ghostty parses
// --args via ghostty_init(argc, argv) at launch — so -n is needed
// to ensure the args are read instead of dropped on activation.
//
// Spawned children are detached + unref'd so quitting Goblin doesn't
// bring the terminal down with it.
export async function openInGhostty(p: string): Promise<{ ok: boolean; message: string }> {
  if (!isUsableDirectory(p)) return { ok: false, message: 'error.invalid-path' }
  if (!isGhosttyInstalled()) return { ok: false, message: 'error.ghostty-not-installed' }

  try {
    if (await openInRunningGhostty(p)) return { ok: true, message: p }
  } catch (err) {
    console.warn('[ghostty] AppleScript open failed, falling back to launch', err)
  }

  try {
    const child = spawn('open', ['-na', 'Ghostty.app', '--args', `--working-directory=${p}`], {
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
    return { ok: true, message: p }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}
