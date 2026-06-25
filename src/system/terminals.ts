// Terminal backend registry. Each terminal app implements TerminalBackend
// and registers itself here.
//
// Adding a new terminal:
// 1. Create src/main/system/<name>.ts implementing TerminalBackend
// 2. Register it in the `backends` map below
// 3. Add the new id to TerminalApp in shared/settings.ts
// 4. Add i18n keys for the workspace picker

import type { TerminalApp, TerminalAppAvailability } from '#/shared/api-types.ts'
import type { ExecResult } from '#/shared/git-types.ts'
import { isGhosttyInstalled, openInGhostty, openRemoteInGhostty } from '#/system/ghostty.ts'
import { isAppleTerminalInstalled, openInAppleTerminal, openRemoteInAppleTerminal } from '#/system/apple-terminal.ts'
import { isWindowsTerminalInstalled, openInWindowsTerminal } from '#/system/windows-terminal.ts'

export interface TerminalBackend {
  /** Open a directory in this terminal. */
  open: (path: string) => Promise<ExecResult>
  /** Open a remote SSH workspace in this terminal. Optional: a backend
   *  without support returns `error.remote-terminal-not-supported` from
   *  `openRemoteInPreferredTerminal`. */
  openRemote?: (alias: string, remotePath: string) => Promise<ExecResult>
}

/** Concrete terminal app backends.
 *
 *  Backends hold function references, not invocation results — so they're
 *  inherently lazy w.r.t. `process.platform`. Per-backend `isInstalled`
 *  checks live with each backend (e.g. `isWindowsTerminalInstalled` already
 *  short-circuits on non-win32) and are reached through
 *  `getTerminalAppAvailability` below, which is the only place platform
 *  gating belongs. */
const backends: Record<TerminalApp, TerminalBackend> = {
  ghostty: { open: openInGhostty, openRemote: openRemoteInGhostty },
  terminal: { open: openInAppleTerminal, openRemote: openRemoteInAppleTerminal },
  windowsTerminal: { open: openInWindowsTerminal },
}

export async function getTerminalAppAvailability(signal?: AbortSignal): Promise<TerminalAppAvailability> {
  if (process.platform === 'win32') {
    return { ghostty: false, terminal: false, windowsTerminal: isWindowsTerminalInstalled() }
  }
  if (process.platform !== 'darwin') {
    return { ghostty: false, terminal: false, windowsTerminal: false }
  }
  return {
    ghostty: isGhosttyInstalled(),
    terminal: await isAppleTerminalInstalled(signal),
    windowsTerminal: false,
  }
}

/** Open `path` in the requested terminal `app`. */
export async function openInPreferredTerminal(path: string, app: TerminalApp): Promise<ExecResult> {
  const availability = await getTerminalAppAvailability()
  if (!availability[app]) return { ok: false, message: 'error.terminal-not-installed' }
  return backends[app].open(path)
}

/** Open a remote SSH workspace in the requested terminal `app`. */
export async function openRemoteInPreferredTerminal(
  alias: string,
  remotePath: string,
  app: TerminalApp,
): Promise<ExecResult> {
  const availability = await getTerminalAppAvailability()
  if (!availability[app]) return { ok: false, message: 'error.terminal-not-installed' }
  const openRemote = backends[app].openRemote
  return openRemote ? openRemote(alias, remotePath) : { ok: false, message: 'error.remote-terminal-not-supported' }
}
