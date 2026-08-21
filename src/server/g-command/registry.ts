import stringWidth from 'string-width'
import type { GoblinCommand, GoblinCommandContext } from '#/server/g-command/context.ts'
import { padTerminalTextEnd } from '#/server/common/terminal-text.ts'
import { INIT_COMMAND } from '#/server/g-command/commands/init.ts'
import { VIEW_COMMANDS } from '#/server/g-command/commands/view.ts'
import { TERM_COMMAND } from '#/server/g-command/commands/term.ts'

// Canonical registry for `g` command dispatch and help output.
const HELP_COMMAND: GoblinCommand = {
  name: 'help',
  summary: 'Show this help.',
  async run(ctx: GoblinCommandContext): Promise<number> {
    ctx.io.stdout(formatUsage(COMMANDS))
    return 0
  },
}

export const COMMANDS: readonly GoblinCommand[] = [HELP_COMMAND, INIT_COMMAND, TERM_COMMAND, ...VIEW_COMMANDS]

export function findCommand(name: string): GoblinCommand | null {
  return COMMANDS.find((command) => command.name === name) ?? null
}

export function formatUsage(commands: readonly GoblinCommand[]): string {
  // Build the left column (each entry's invocation) and right column
  // (one-line summary), then align the left column by its widest row.
  // `command.usage ?? \`g ${command.name}\`` lets a command override
  // the default rendering (e.g. `g log <ref>`) without forcing every
  // command to spell it out.
  const entries = commands.map((command) => ({ command, usage: `  ${command.usage ?? `g ${command.name}`}` }))
  const columnWidth = Math.max(...entries.map(({ usage }) => stringWidth(usage))) + 2
  const rows = entries.map(({ command, usage }) => `${padTerminalTextEnd(usage, columnWidth)}${command.summary}`)
  return ['Goblin terminal command', '', 'Usage:', ...rows].join('\n')
}
