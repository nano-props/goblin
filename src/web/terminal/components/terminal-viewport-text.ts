import type { IBuffer } from '@xterm/xterm'

interface TerminalViewportTextInput {
  buffer: Pick<IBuffer, 'getLine' | 'viewportY'>
  rows: number
  cols: number
}

export function terminalViewportText(input: TerminalViewportTextInput): string {
  if (input.rows <= 0 || input.cols <= 0) return ''

  const lines = Array.from({ length: input.rows }, (_, offset) => {
    const line = input.buffer.getLine(input.buffer.viewportY + offset)
    return {
      text: (line?.translateToString(true, 0, input.cols) ?? '').replaceAll('\u00a0', ' '),
      wrapped: line?.isWrapped ?? false,
    }
  })
  while (lines.at(-1)?.text === '') lines.pop()

  return lines.reduce((text, line, index) => {
    const separator = index > 0 && !line.wrapped ? '\n' : ''
    return `${text}${separator}${line.text}`
  }, '')
}
