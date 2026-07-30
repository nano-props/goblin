import * as v from 'valibot'
import type { TerminalSize } from '#/shared/terminal-types.ts'

const MIN_TERMINAL_COLS = 1
const MAX_TERMINAL_COLS = 500
const MIN_TERMINAL_ROWS = 1
const MAX_TERMINAL_ROWS = 300

export const MAX_TERMINAL_WRITE_CHARS = 1024 * 1024
export const TERMINAL_WS_MESSAGE_LIMIT_BYTES = MAX_TERMINAL_WRITE_CHARS

export const TerminalColsSchema = v.pipe(
  v.number(),
  v.integer(),
  v.minValue(MIN_TERMINAL_COLS),
  v.maxValue(MAX_TERMINAL_COLS),
)
export const TerminalRowsSchema = v.pipe(
  v.number(),
  v.integer(),
  v.minValue(MIN_TERMINAL_ROWS),
  v.maxValue(MAX_TERMINAL_ROWS),
)
export const TerminalSizeSchema = v.strictObject({ cols: TerminalColsSchema, rows: TerminalRowsSchema })
export const TerminalWriteDataSchema = v.pipe(
  v.string(),
  v.maxLength(MAX_TERMINAL_WRITE_CHARS),
  v.check((value) => !value.includes('\0'), 'Invalid terminal input'),
)

export function isValidTerminalWriteData(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_TERMINAL_WRITE_CHARS && !value.includes('\0')
}

export function terminalUtf8ByteLength(value: string): number {
  let bytes = 0
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code <= 0x7f) {
      bytes += 1
    } else if (code <= 0x7ff) {
      bytes += 2
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        i += 1
      } else {
        bytes += 3
      }
    } else {
      bytes += 3
    }
  }
  return bytes
}

export function isTerminalWsMessageWithinLimit(value: string): boolean {
  return terminalUtf8ByteLength(value) <= TERMINAL_WS_MESSAGE_LIMIT_BYTES
}

export function constrainTerminalSize(cols: number, rows: number): TerminalSize | null {
  if (!Number.isFinite(cols) || !Number.isFinite(rows)) return null
  return {
    cols: Math.min(MAX_TERMINAL_COLS, Math.max(MIN_TERMINAL_COLS, Math.floor(cols))),
    rows: Math.min(MAX_TERMINAL_ROWS, Math.max(MIN_TERMINAL_ROWS, Math.floor(rows))),
  }
}

export function normalizeTerminalSize(cols: unknown, rows: unknown): TerminalSize | null {
  if (typeof cols !== 'number' || typeof rows !== 'number' || !Number.isFinite(cols) || !Number.isFinite(rows)) {
    return null
  }
  const normalizedCols = Math.floor(cols)
  const normalizedRows = Math.floor(rows)
  if (
    normalizedCols < MIN_TERMINAL_COLS ||
    normalizedCols > MAX_TERMINAL_COLS ||
    normalizedRows < MIN_TERMINAL_ROWS ||
    normalizedRows > MAX_TERMINAL_ROWS
  ) {
    return null
  }
  return { cols: normalizedCols, rows: normalizedRows }
}

export function isValidTerminalSize(cols: unknown, rows: unknown): boolean {
  return normalizeTerminalSize(cols, rows) !== null
}
