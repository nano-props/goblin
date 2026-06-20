import { runGoblinCommand } from '#/server/g-command/cli.ts'

if (import.meta.main) {
  process.exitCode = await runGoblinCommand()
}
