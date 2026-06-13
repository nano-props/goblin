#!/usr/bin/env bun
// Gracefully quit a running Goblin app, force-killing if it doesn't respond.
// macOS uses AppleScript + pgrep; Windows uses tasklist + taskkill. On other
// platforms this is a no-op, since the install flow it serves only runs on
// macOS or Windows.
import { $ } from 'bun'
import { setTimeout as sleep } from 'node:timers/promises'

const APP_NAME = 'Goblin'

// Match only the packaged binary launched by launchd/Finder. A loose
// pattern like `${APP_NAME}.app` would also match unrelated shells and
// tools whose argv happens to contain the path to Goblin.app.
const MAC_BINARY_PATH_FRAGMENT = `/${APP_NAME}.app/Contents/MacOS/`
// On Windows the unpacked install lives at
// %LOCALAPPDATA%\Programs\Goblin[ -arm64]\Goblin.exe.
const WIN_BINARY_PATH_FRAGMENT = `\\Programs\\${APP_NAME}`
const WIN_IMAGE_NAME = 'Goblin.exe'

async function isRunningMac(): Promise<boolean> {
  // pgrep exits 0 when a match is found, 1 when not. Any other code is an
  // actual error (e.g. pgrep missing) — treat as "not running" to avoid
  // blocking the install flow.
  const r = await $`pgrep -f ${MAC_BINARY_PATH_FRAGMENT}`.quiet().nothrow()
  return r.exitCode === 0
}

async function isRunningWin(): Promise<boolean> {
  // tasklist's image-name filter is case-insensitive on Windows and
  // matches the bare exe name. EXIT 0 with no `Goblin.exe` line means
  // the app isn't running.
  const r = await $`tasklist /FI ${`IMAGENAME eq ${WIN_IMAGE_NAME}`} /NH`.quiet().nothrow()
  if (r.exitCode !== 0) return false
  return r.stdout.toString().toLowerCase().includes(WIN_IMAGE_NAME.toLowerCase())
}

export async function closeRunningApp(): Promise<void> {
  if (process.platform === 'darwin') {
    if (!(await isRunningMac())) return
    console.log(`${APP_NAME} is running, attempting graceful quit...`)
    // osascript may fail if the app just exited; fall through to the wait loop.
    await $`osascript -e ${`quit app "${APP_NAME}"`}`.quiet().nothrow()

    for (let i = 0; i < 10; i++) {
      if (!(await isRunningMac())) {
        console.log(`${APP_NAME} quit.`)
        return
      }
      await sleep(500)
    }

    if (await isRunningMac()) {
      console.log(`Forcing ${APP_NAME} to quit...`)
      await $`pkill -9 -f ${MAC_BINARY_PATH_FRAGMENT}`.quiet().nothrow()
      await sleep(1000)
    }
    return
  }

  if (process.platform === 'win32') {
    if (!(await isRunningWin())) return
    console.log(`${APP_NAME} is running, attempting graceful close...`)
    // WM_CLOSE is what taskkill performs without /F. The packaged app
    // hooks before-quit to flush window state and shut down the embedded
    // server, so a clean close is safe to wait for.
    await $`taskkill /IM ${WIN_IMAGE_NAME}`.quiet().nothrow()
    for (let i = 0; i < 10; i++) {
      if (!(await isRunningWin())) {
        console.log(`${APP_NAME} closed.`)
        return
      }
      await sleep(500)
    }
    if (await isRunningWin()) {
      console.log(`Forcing ${APP_NAME} to quit...`)
      await $`taskkill /F /IM ${WIN_IMAGE_NAME}`.quiet().nothrow()
      await sleep(1000)
    }
  }
}

if (import.meta.main) await closeRunningApp()
