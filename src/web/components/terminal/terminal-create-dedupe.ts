import type { TerminalCreateOptions } from '#/web/components/terminal/types.ts'

export function terminalCreateDedupeKey(options: TerminalCreateOptions = {}): string | null {
  if (options.resolveStartupShellCommand) return null
  return options.startupShellCommand ?? ''
}
