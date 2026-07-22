import { execa } from 'execa'
import { existsSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const OPEN_TIMEOUT_MS = 10_000
const WT_EXE = 'wt.exe'

/**
 * Reject anything we cannot pass to wt.exe safely:
 * - non-absolute paths don't have a working directory to chdir into
 * - embedded NUL bytes break any downstream shell/argv serialization
 *
 * On win32, `path.isAbsolute` is `path.win32.isAbsolute`, so a forward-slash
 * `C:/Users/foo` resolves to `true` (it accepts both separators).
 */
function isUsableDirectory(p: string): boolean {
  if (!path.isAbsolute(p) || p.includes('\0')) return false
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/**
 * Detection is intentionally narrow: Windows Terminal is "installed" only
 * when `wt.exe` is actually findable. We deliberately do NOT fall back to
 * `cmd.exe` here — that would let the settings UI flag Windows Terminal as
 * available on stock Windows machines, and silently launch a bare cmd.exe
 * window when the user picked "Windows Terminal". If the user wants a
 * cmd.exe-based open they can pick a different backend (when we add one).
 */
export function isWindowsTerminalInstalled(): boolean {
  if (process.platform !== 'win32') return false
  return findWindowsTerminalExecutable() !== null
}

export async function openInWindowsTerminal(p: string): Promise<{ ok: boolean; message: string }> {
  if (!isUsableDirectory(p)) return { ok: false, message: 'error.invalid-path' }
  const windowsTerminal = findWindowsTerminalExecutable()
  if (!windowsTerminal) return { ok: false, message: 'error.terminal-not-installed' }

  try {
    const child = execa(windowsTerminal, ['-d', p], {
      detached: true,
      stdio: 'ignore',
      cleanup: false,
      timeout: OPEN_TIMEOUT_MS,
      forceKillAfterDelay: 500,
    })
    child.nodeChildProcess.unref()
    await child
    return { ok: true, message: p }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

function findWindowsTerminalExecutable(): string | null {
  const localAppData = process.env.LOCALAPPDATA
  const candidates = [
    findExecutableOnPath(WT_EXE),
    localAppData ? path.join(localAppData, 'Microsoft', 'WindowsApps', WT_EXE) : null,
    path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WindowsApps', WT_EXE),
  ].filter((candidate): candidate is string => candidate !== null)
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function findExecutableOnPath(name: string): string | null {
  const pathEntries = (process.env.PATH ?? '').split(path.delimiter).filter((entry) => entry.length > 0)
  const extensions = executableExtensions(name)
  for (const entry of pathEntries) {
    for (const extension of extensions) {
      const candidate = path.join(entry, extension ? `${name}${extension}` : name)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

function executableExtensions(name: string): string[] {
  if (path.extname(name)) return ['']
  const raw = process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD'
  return raw
    .split(';')
    .map((extension) => extension.trim())
    .filter((extension) => extension.length > 0)
}
