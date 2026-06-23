// Entry point for the `g` shell command. Reduced to lookup-and-run
// after the registry refactor — `g <subcommand>` resolution is now
// data-driven via `#/server/g-command/registry.ts`. The CLI itself
// owns the I/O envelope (stdout/stderr shape, exit codes) but does
// not know about any specific subcommand's semantics.
//
// The transport layer (`#/server/g-command/transport.ts` in this
// directory, used by `#/server/entrypoints/g-command.ts`) provides
// HTTP access to the parent server. Tests inject a mock transport
// via the `GoblinCommandContext` parameter, so this file has no
// server-internal imports beyond the registry.

import type {
  GoblinCommandContext,
  GoblinCommandIo,
  GoblinCommandTransport,
} from '#/server/g-command/context.ts'
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
