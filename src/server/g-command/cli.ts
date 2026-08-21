// The `g` CLI owns command dispatch, I/O formatting, and exit codes. Each
// registered command owns its argument and domain semantics.

import type { GoblinCommandContext, GoblinCommandIo, GoblinCommandTransport } from '#/server/g-command/context.ts'
import { findCommand, formatUsage, COMMANDS } from '#/server/g-command/registry.ts'

export async function runGoblinCommand(
  args: string[],
  env: NodeJS.ProcessEnv,
  io: GoblinCommandIo,
  transport: GoblinCommandTransport,
): Promise<number> {
  const commandName = args[0] || 'help'
  const command = findCommand(commandName)
  if (!command) {
    io.stderr(`g: unknown command: ${commandName}\n\n${formatUsage(COMMANDS)}`)
    return 2
  }
  const ctx: GoblinCommandContext = {
    args,
    env,
    io,
    transport,
  }
  try {
    return await command.run(ctx)
  } catch (err) {
    io.stderr(`g: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }
}
