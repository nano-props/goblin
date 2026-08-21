// Terminal backends own app-specific availability and launch behavior. This
// registry keeps the shared TerminalApp contract exhaustive.

import type { TerminalApp, TerminalAppAvailability } from '#/shared/settings.ts'
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
