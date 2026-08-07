import { isAbsolutePathLike, isTerminalPastePathSafe } from '#/shared/clipboard-paste.ts'
import { TERMINAL_WS_MESSAGE_LIMIT_BYTES, terminalUtf8ByteLength } from '#/shared/terminal-protocol-constraints.ts'

const PASTE_PATH_WRITE_MARGIN_BYTES = 4096
const PASTE_PATH_MAX_WRITE_BYTES = TERMINAL_WS_MESSAGE_LIMIT_BYTES - PASTE_PATH_WRITE_MARGIN_BYTES

export type TerminalPathWritePlan =
  { kind: 'none' } | { kind: 'invalid' } | { kind: 'unsafe' } | { kind: 'too-long' } | { kind: 'write'; data: string }

export function planTerminalPathWrite(paths: string[]): TerminalPathWritePlan {
  if (paths.length === 0) return { kind: 'none' }
  // A path list is one accepted terminal action. Filtering would turn an
  // invalid response into a different command with silently missing arguments.
  if (paths.some((path) => path.length === 0 || !isAbsolutePathLike(path))) return { kind: 'invalid' }
  if (paths.some((path) => !isTerminalPastePathSafe(path))) return { kind: 'unsafe' }
  const data = paths.map(shellEscapePath).join(' ')
  // The server caps the whole WebSocket message, not just input.data.
  // Measure the JSON-escaped payload so paths full of backslashes or
  // double quotes cannot pass this check and then close the socket.
  // Use UTF-8 bytes to match the WebSocket transport cap.
  if (terminalUtf8ByteLength(JSON.stringify(data)) > PASTE_PATH_MAX_WRITE_BYTES) return { kind: 'too-long' }
  return { kind: 'write', data }
}

export function shellEscapePath(path: string): string {
  if (path.length === 0) return "''"
  return "'" + path.replace(/'/g, "'\\''") + "'"
}
