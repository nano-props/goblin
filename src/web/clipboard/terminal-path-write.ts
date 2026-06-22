import { isTerminalPastePathSafe } from '#/shared/clipboard-paste.ts'
import { TERMINAL_WS_MESSAGE_LIMIT_BYTES, terminalUtf8ByteLength } from '#/shared/terminal-validators.ts'

const PASTE_PATH_WRITE_MARGIN_BYTES = 4096
const PASTE_PATH_MAX_WRITE_BYTES = TERMINAL_WS_MESSAGE_LIMIT_BYTES - PASTE_PATH_WRITE_MARGIN_BYTES

export interface TerminalPathWriteFailures {
  failedUnsafe: number
  failedBackend: number
}

export type TerminalPathWritePlan =
  | { kind: 'none'; failures: TerminalPathWriteFailures }
  | { kind: 'too-long' }
  | { kind: 'write'; data: string; failures: TerminalPathWriteFailures }

export function planTerminalPathWrite(paths: string[], failures: TerminalPathWriteFailures): TerminalPathWritePlan {
  const safePaths = paths.filter(isTerminalPastePathSafe)
  const nextFailures = {
    failedUnsafe: failures.failedUnsafe + paths.length - safePaths.length,
    failedBackend: failures.failedBackend,
  }
  if (safePaths.length === 0) return { kind: 'none', failures: nextFailures }
  const data = safePaths.map(shellEscapePath).join(' ')
  // The server caps the whole WebSocket message, not just input.data.
  // Measure the JSON-escaped payload so paths full of backslashes or
  // double quotes cannot pass this check and then close the socket.
  // Use UTF-8 bytes to match the WebSocket transport cap.
  if (terminalUtf8ByteLength(JSON.stringify(data)) > PASTE_PATH_MAX_WRITE_BYTES) return { kind: 'too-long' }
  return { kind: 'write', data, failures: nextFailures }
}

export function shellEscapePath(path: string): string {
  if (path.length === 0) return "''"
  return "'" + path.replace(/'/g, "'\\''") + "'"
}
