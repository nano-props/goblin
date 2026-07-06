import type { TerminalCreateOptions } from '#/web/components/terminal/types.ts'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'

export async function createWorkspacePaneTerminalTab(input: {
  base: TerminalSessionBase
  createTerminal: (base: TerminalSessionBase, options?: TerminalCreateOptions) => Promise<string>
  options?: TerminalCreateOptions
}): Promise<string> {
  return input.options ? await input.createTerminal(input.base, input.options) : await input.createTerminal(input.base)
}
