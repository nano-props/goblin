#!/usr/bin/env bun
// Manage a running Goblin app:
//   - closeRunningApp(): gracefully quit, force-killing if it doesn't respond
//     (macOS uses AppleScript + pgrep; Windows uses tasklist + taskkill).
//   - launchInstalledApp(): start the freshly installed binary at the given
//     destination. macOS uses `open -g` to avoid stealing focus; Windows
//     spawns the .exe detached so the build script can exit cleanly.
// On other platforms both are no-ops, since the install flow only runs on
// macOS or Windows.
import { $ } from 'bun'
import { existsSync } from 'node:fs'
import path from 'node:path'
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

export async function launchInstalledApp(destPath: string, appName: string): Promise<void> {
  if (process.platform === 'darwin') {
    // `open -g` launches without stealing focus from whatever the user was
    // doing during the build. `open` hands off to launchd and exits almost
    // immediately, so awaiting surfaces a missing/broken .app without
    // blocking on the launched app itself.
    const proc = Bun.spawn(['open', '-g', destPath], { stdout: 'inherit', stderr: 'inherit' })
    if ((await proc.exited) !== 0) {
      console.warn(`Warning: open exited non-zero; ${appName} may not have launched.`)
    }
    return
  }
  if (process.platform === 'win32') {
    const exe = path.join(destPath, `${appName}.exe`)
    if (!existsSync(exe)) {
      console.warn(`Warning: ${exe} not found; ${appName} was not launched.`)
      return
    }
    // Detach so the build script can exit without taking the app down.
    const proc = Bun.spawn([exe], { detached: true, stdout: 'ignore', stderr: 'ignore' })
    proc.unref()
  }
}

if (import.meta.main) await closeRunningApp()
