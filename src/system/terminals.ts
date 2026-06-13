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
import { isGhosttyInstalled, openInGhostty } from '#/system/ghostty.ts'
import { isAppleTerminalInstalled, openInAppleTerminal } from '#/system/apple-terminal.ts'
import { isWindowsTerminalInstalled, openInWindowsTerminal } from '#/system/windows-terminal.ts'

export interface TerminalBackend {
  /** Whether this terminal is available on the current system.
   *  Sync — backed by file-existence checks that are cheap on macOS.
   *  If a future backend needs async detection (e.g. mdfind), resolve
   *  it at registration time and cache the result. */
  isInstalled: () => boolean
  /** Open a directory in this terminal. */
  open: (path: string) => Promise<{ ok: boolean; message: string }>
}

/** Concrete terminal pref values (excludes 'auto'). */
const backends: Record<ResolvedTerminalApp, TerminalBackend> = {
  ghostty: { isInstalled: isGhosttyInstalled, open: openInGhostty },
  terminal: { isInstalled: () => true, open: openInAppleTerminal },
  windowsTerminal: { isInstalled: isWindowsTerminalInstalled, open: openInWindowsTerminal },
}

/** Auto-detection priority — first installed backend wins. */
const AUTO_PRIORITY: ResolvedTerminalApp[] = ['ghostty', 'terminal', 'windowsTerminal']

function isDarwin(): boolean {
  return process.platform === 'darwin'
}

function isWindows(): boolean {
  return process.platform === 'win32'
}

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
  if (isWindows()) {
    return {
      ghostty: false,
      terminal: false,
      windowsTerminal: backends.windowsTerminal.isInstalled(),
    }
  }
  if (!isDarwin()) {
    return {
      ghostty: false,
      terminal: false,
      windowsTerminal: false,
    }
  }
  return {
    ghostty: backends.ghostty.isInstalled(),
    terminal: await isAppleTerminalInstalled(signal),
    windowsTerminal: false,
  }
}

/** Open `path` in the terminal selected by `pref`. */
export async function openInPreferredTerminal(
  path: string,
  pref: TerminalPref,
): Promise<{ ok: boolean; message: string }> {
  const resolved = resolveTerminalApp(pref, await getTerminalAppAvailability())
  return resolved
    ? backends[resolved].open(path)
    : Promise.resolve({ ok: false, message: 'error.terminal-not-installed' })
}

export async function getResolvedTerminalApp(pref: TerminalPref): Promise<ResolvedTerminalApp | null> {
  return resolveTerminalApp(pref, await getTerminalAppAvailability())
}
