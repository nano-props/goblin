import { terminalLog } from '#/web/logger.ts'
import type { TerminalCreateOptions } from '#/web/components/terminal/types.ts'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import {
  showTerminalCreateErrorToast,
  terminalCreateErrorKey,
  type TerminalCreateTranslator,
} from '#/web/components/terminal/terminal-create-feedback.ts'
import { createWorkspacePaneTerminalTab } from '#/web/workspace-pane/workspace-pane-terminal-create.ts'

export type TerminalCreateCommandResult =
  { ok: true; terminalKey: string } | { ok: false; error: unknown; messageKey: string }

export async function runCreateTerminalTabCommand(input: {
  base: TerminalSessionBase
  createTerminal: (base: TerminalSessionBase, options?: TerminalCreateOptions) => Promise<string>
  options?: TerminalCreateOptions
  t?: TerminalCreateTranslator
  logMessage?: string
}): Promise<TerminalCreateCommandResult> {
  try {
    const terminalKey = await createWorkspacePaneTerminalTab({
      base: input.base,
      createTerminal: input.createTerminal,
      options: input.options,
    })
    return { ok: true, terminalKey }
  } catch (error) {
    const messageKey = input.t ? showTerminalCreateErrorToast(error, input.t) : terminalCreateErrorKey(error)
    terminalLog.warn(input.logMessage ?? 'failed to create terminal', { err: error, messageKey })
    return { ok: false, error, messageKey }
  }
}
