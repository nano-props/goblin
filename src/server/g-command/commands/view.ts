import * as v from 'valibot'
import type { GoblinCommand, GoblinCommandContext } from '#/server/g-command/context.ts'
import { GOBLIN_SERVER_COMMAND_RESULT_SCHEMA } from '#/shared/g-command.ts'

type ViewCommandName = 'delta' | 'info' | 'log'

const VIEW_COMMAND_SUMMARIES: Record<ViewCommandName, string> = {
  delta: 'Open the changes tab in the Goblin window',
  info: 'Open the status tab in the Goblin window',
  log: 'Open the history tab in the Goblin window',
}

function createViewCommand(name: ViewCommandName): GoblinCommand {
  return {
    name,
    summary: VIEW_COMMAND_SUMMARIES[name],
    async run(ctx: GoblinCommandContext): Promise<number> {
      try {
        await ctx.transport.postJson(
          '/api/terminal-command',
          { command: name, payload: { args: ctx.args.slice(1) } },
          (value) => v.parse(GOBLIN_SERVER_COMMAND_RESULT_SCHEMA, value),
        )
        return 0
      } catch (error) {
        ctx.io.stderr(`g: ${error instanceof Error ? error.message : String(error)}`)
        return 1
      }
    },
  }
}

export const VIEW_COMMANDS: readonly GoblinCommand[] = [
  createViewCommand('delta'),
  createViewCommand('info'),
  createViewCommand('log'),
]
