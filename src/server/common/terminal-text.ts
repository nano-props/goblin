import stringWidth from 'string-width'

export function padTerminalTextEnd(value: string, width: number): string {
  return `${value}${' '.repeat(Math.max(0, width - stringWidth(value)))}`
}
