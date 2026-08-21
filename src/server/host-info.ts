// Public, non-secret host facts used for platform-aware client presentation.

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
