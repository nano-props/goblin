import path from 'node:path'
import { promises as fs } from 'node:fs'
import type { GoblinCommand, GoblinCommandContext } from '#/server/g-command/context.ts'

const CONFIG_FILE = 'goblin.toml'

const INITIAL_CONFIG = `# AI assistants: use this file only for local worktree bootstrap rules.
# Add a [worktree] table with copy, symlink, hardlink, exclude, and setup when needed.
# Use repo-relative paths only. Do not include secrets, .git, or dependency directories.
`

export const INIT_COMMAND: GoblinCommand = {
  name: 'init',
  summary: 'Create goblin.toml.',
  async run(ctx: GoblinCommandContext): Promise<number> {
    if (ctx.args.length > 1) {
      ctx.io.stderr("g: 'init' does not take arguments\n\nUsage: g init")
      return 2
    }

    const target = path.join(process.cwd(), CONFIG_FILE)
    try {
      await fs.writeFile(target, INITIAL_CONFIG, { encoding: 'utf8', flag: 'wx' })
      ctx.io.stdout(`Created ${CONFIG_FILE}`)
      return 0
    } catch (err) {
      if (isErrno(err, 'EEXIST')) {
        ctx.io.stderr(`g: ${CONFIG_FILE} exists`)
        return 1
      }
      ctx.io.stderr(`g: failed to create ${CONFIG_FILE}: ${errorMessage(err)}`)
      return 1
    }
  },
}

function isErrno(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: unknown }).code === code
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
