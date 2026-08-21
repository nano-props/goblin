import * as v from 'valibot'
import type { GoblinCommand } from '#/server/g-command/context.ts'
import { GOBLIN_SERVER_COMMAND_RESULT_SCHEMA, GOBLIN_TERMINAL_SESSION_ID_ENV } from '#/shared/g-command.ts'

export const TERM_COMMAND: GoblinCommand = {
  name: 'term',
  usage: 'g term [list|prune]',
  summary: 'Inspect or prune Goblin terminals.',
  async run(ctx): Promise<number> {
    try {
      const result = await ctx.transport.postJson(
        '/api/terminal-command',
        {
          command: 'term',
          payload: {
            terminalSessionId: ctx.env[GOBLIN_TERMINAL_SESSION_ID_ENV] ?? '',
            args: ctx.args.slice(1),
          },
        },
        (value) => v.parse(GOBLIN_SERVER_COMMAND_RESULT_SCHEMA, value),
      )
      ctx.io.stdout(result.output)
      return 0
    } catch (error) {
      ctx.io.stderr(`g: ${error instanceof Error ? error.message : String(error)}`)
      return 1
    }
  },
}
