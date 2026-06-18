// Host info the server already knows about itself. The server
// runs on the same OS as the embedded renderer, so the values
// it returns match what the user's terminal sees (`uname`,
// `echo $HOME`, etc.). Exposed as a public endpoint because the
// info isn't sensitive — `homeDir` and `platform` are what the
// app needs to render platform-aware UI, not secrets.
//
// Used to be ferried into the renderer via the Electron
// preload's `goblin:get-home-dir` / `goblin:get-platform` IPC.
// Moving it to a public endpoint:
//  - collapses one more IPC surface
//  - makes the Vite-served dev path identical to the embedded
//    path (both go through HTTP; no "if Electron, then sync IPC"
//    special case)
//  - keeps the renderer identical across runtimes: it's
//    just an HTTP fetch at boot

import os from 'node:os'

export interface HostInfo {
  /** Absolute path of the user's home directory. */
  homeDir: string
  /** Node.js platform identifier (`'darwin' | 'win32' | 'linux' | ...`). */
  platform: NodeJS.Platform
  /** Server's hostname (informational; used in error messages). */
  hostname: string
  /** Process id of the server (informational; used in logs). */
  pid: number
}

export function getServerHostInfo(): HostInfo {
  return {
    homeDir: os.homedir(),
    platform: process.platform,
    hostname: os.hostname(),
    pid: process.pid,
  }
}
