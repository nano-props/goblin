import type { TerminalCreateOptions } from '#/web/terminal/components/types.ts'

export function terminalCreateDedupeKey(options: TerminalCreateOptions = {}): string | null {
  if (options.resolveStartupShellCommand) return null
  return options.startupShellCommand ?? ''
}
