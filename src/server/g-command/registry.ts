import type { GoblinCommand, GoblinCommandContext } from '#/server/g-command/context.ts'
import { INIT_COMMAND } from '#/server/g-command/commands/init.ts'
import { VIEW_COMMANDS } from '#/server/g-command/commands/view.ts'

// Registry of every `g` subcommand. To add a new command:
//   1) Implement it (own file under `commands/` or inline here).
//   2) Append it to `COMMANDS`.
//
// The CLI (`cli.ts`) does lookup-and-run only — it never references
// individual command names. Adding/removing a command should never
// require touching `cli.ts` beyond this file.
const HELP_COMMAND: GoblinCommand = {
  name: 'help',
  summary: 'Show this help.',
  async run(ctx: GoblinCommandContext): Promise<number> {
    ctx.io.stdout(formatUsage(COMMANDS))
    return 0
  },
}

export const COMMANDS: readonly GoblinCommand[] = [HELP_COMMAND, INIT_COMMAND, ...VIEW_COMMANDS]

export function findCommand(name: string): GoblinCommand | null {
  return COMMANDS.find((command) => command.name === name) ?? null
}

export function formatUsage(commands: readonly GoblinCommand[]): string {
  // Build the left column (each entry's invocation) and right column
  // (one-line summary), then align the left column by its widest row.
  // `command.usage ?? \`g ${command.name}\`` lets a command override
  // the default rendering (e.g. `g log <ref>`) without forcing every
  // command to spell it out.
  const usages = commands.map((command) => `  ${command.usage ?? `g ${command.name}`}`)
  const columnWidth = Math.max(...usages.map((line) => line.length)) + 2
  const rows = commands.map((command, index) => `${usages[index]!.padEnd(columnWidth)}${command.summary}`)
  return ['Goblin terminal command', '', 'Usage:', ...rows].join('\n')
}
