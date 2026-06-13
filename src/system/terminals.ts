// Terminal backend registry. Each terminal app implements TerminalBackend
// and registers itself here. The resolver picks the right one based on
// the user's TerminalPref setting.
//
// Adding a new terminal:
// 1. Create src/main/system/<name>.ts implementing TerminalBackend
// 2. Register it in the `backends` map below
// 3. Add the new id to TerminalPref in shared/api-types.ts
// 4. Add i18n keys for the settings picker

import type { ResolvedTerminalApp, TerminalAppAvailability, TerminalPref } from '#/shared/api-types.ts'
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

/** Concrete terminal pref values (excludes 'auto').
 *
 *  Backends hold function references, not invocation results — so they're
 *  inherently lazy w.r.t. `process.platform`. Per-backend `isInstalled`
 *  checks live with each backend (e.g. `isWindowsTerminalInstalled` already
 *  short-circuits on non-win32) and are reached through
 *  `getTerminalAppAvailability` below, which is the only place platform
 *  gating belongs. */
const backends: Record<ResolvedTerminalApp, TerminalBackend> = {
  ghostty: { open: openInGhostty, openRemote: openRemoteInGhostty },
  terminal: { open: openInAppleTerminal, openRemote: openRemoteInAppleTerminal },
  windowsTerminal: { open: openInWindowsTerminal },
}

/** Auto-detection priority — first installed backend wins. */
const AUTO_PRIORITY: ResolvedTerminalApp[] = ['ghostty', 'terminal', 'windowsTerminal']

export function resolveTerminalApp(
  pref: TerminalPref,
  availability: TerminalAppAvailability,
): ResolvedTerminalApp | null {
  if (pref !== 'auto') {
    return availability[pref] ? pref : null
  }
  for (const id of AUTO_PRIORITY) {
    if (availability[id]) return id
  }
  return null
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

/** Open `path` in the terminal selected by `pref`. */
export async function openInPreferredTerminal(path: string, pref: TerminalPref): Promise<ExecResult> {
  const resolved = resolveTerminalApp(pref, await getTerminalAppAvailability())
  return resolved
    ? backends[resolved].open(path)
    : { ok: false, message: 'error.terminal-not-installed' }
}

/** Open a remote SSH workspace in the terminal selected by `pref`. */
export async function openRemoteInPreferredTerminal(
  alias: string,
  remotePath: string,
  pref: TerminalPref,
): Promise<ExecResult> {
  const resolved = resolveTerminalApp(pref, await getTerminalAppAvailability())
  if (!resolved) return { ok: false, message: 'error.terminal-not-installed' }
  const openRemote = backends[resolved].openRemote
  return openRemote ? openRemote(alias, remotePath) : { ok: false, message: 'error.remote-terminal-not-supported' }
}

export async function getResolvedTerminalApp(pref: TerminalPref): Promise<ResolvedTerminalApp | null> {
  return resolveTerminalApp(pref, await getTerminalAppAvailability())
}
