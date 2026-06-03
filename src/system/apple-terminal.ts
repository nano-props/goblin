import { execa } from 'execa'
import { statSync } from 'node:fs'
import path from 'node:path'

const OPEN_TIMEOUT_MS = 10_000
export const TERMINAL_APP_CANDIDATES = [
  '/System/Applications/Utilities/Terminal.app',
  '/Applications/Utilities/Terminal.app',
]

function isUsableDirectory(p: string): boolean {
  if (!path.isAbsolute(p) || p.includes('\0')) return false
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** Open `dir` in macOS Terminal.app.
 *
 *  `open -a Terminal <dir>` tells macOS to open a new Terminal window
 *  with its working directory set to `dir`. Works whether Terminal is
 *  already running or not — the path is passed as a native argument,
 *  so there are no escaping or injection concerns. */
export async function openInAppleTerminal(p: string): Promise<{ ok: boolean; message: string }> {
  if (!isUsableDirectory(p)) return { ok: false, message: 'error.invalid-path' }

  try {
    await execa('open', ['-a', 'Terminal', p], {
      timeout: OPEN_TIMEOUT_MS,
      forceKillAfterDelay: 500,
    })
    return { ok: true, message: p }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

export function hasAppleTerminalAtKnownPaths(candidates: readonly string[] = TERMINAL_APP_CANDIDATES): boolean {
  return candidates.some((candidate) => isUsableDirectory(candidate))
}

export async function isAppleTerminalInstalled(_signal?: AbortSignal): Promise<boolean> {
  return hasAppleTerminalAtKnownPaths()
}
