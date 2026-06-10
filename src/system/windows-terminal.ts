import { execa } from 'execa'
import { existsSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const OPEN_TIMEOUT_MS = 10_000
const CMD_EXE = 'cmd.exe'
const WT_EXE = 'wt.exe'

function isUsableDirectory(p: string): boolean {
  if (!path.isAbsolute(p) || p.includes('\0')) return false
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

export function isWindowsTerminalInstalled(): boolean {
  if (process.platform !== 'win32') return false
  return findWindowsTerminalExecutable() !== null || findExecutableOnPath(CMD_EXE) !== null
}

export async function openInWindowsTerminal(p: string): Promise<{ ok: boolean; message: string }> {
  if (!isUsableDirectory(p)) return { ok: false, message: 'error.invalid-path' }
  const windowsTerminal = findWindowsTerminalExecutable()
  const commandPrompt = findExecutableOnPath(CMD_EXE)
  if (!windowsTerminal && !commandPrompt) return { ok: false, message: 'error.terminal-not-installed' }

  try {
    const child = windowsTerminal
      ? execa(windowsTerminal, ['-d', p], {
          detached: true,
          stdio: 'ignore',
          cleanup: false,
          timeout: OPEN_TIMEOUT_MS,
          forceKillAfterDelay: 500,
        })
      : execa(commandPrompt ?? CMD_EXE, ['/d', '/s', '/c', 'start', '""', '/D', p, CMD_EXE], {
          detached: true,
          stdio: 'ignore',
          cleanup: false,
          timeout: OPEN_TIMEOUT_MS,
          forceKillAfterDelay: 500,
        })
    child.unref()
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
