import { isTerminalPastePathSafe } from '#/shared/clipboard-paste.ts'
import { MAX_TERMINAL_WRITE_CHARS } from '#/shared/terminal-validators.ts'

const PASTE_PATH_WRITE_MARGIN_CHARS = 4096
const PASTE_PATH_MAX_WRITE_CHARS = MAX_TERMINAL_WRITE_CHARS - PASTE_PATH_WRITE_MARGIN_CHARS

export type TerminalPathWritePlan =
  | { kind: 'failed' }
  | { kind: 'too-long' }
  | { kind: 'write'; data: string; failed: number }

export function planTerminalPathWrite(paths: string[], failed: number): TerminalPathWritePlan {
  const safePaths = paths.filter(isTerminalPastePathSafe)
  const failedCount = failed + paths.length - safePaths.length
  if (safePaths.length === 0) return { kind: 'failed' }
  const data = safePaths.map(shellEscapePath).join(' ')
  if (data.length > PASTE_PATH_MAX_WRITE_CHARS) return { kind: 'too-long' }
  return { kind: 'write', data, failed: failedCount }
}

export function shellEscapePath(path: string): string {
  if (path.length === 0) return "''"
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(path)) return path
  return "'" + path.replace(/'/g, "'\\''") + "'"
}
