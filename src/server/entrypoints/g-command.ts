import { runGoblinCommand } from '#/server/g-command/cli.ts'
import { createHttpTransport } from '#/server/g-command/transport.ts'

if (import.meta.main) {
  // The transport constructor throws when the access token is
  // missing; let that propagate to a non-zero exit code so `g`
  // doesn't silently do nothing. Errors here carry the `g:` prefix
  // at this layer (top-level entry point) so they look uniform
  // with command-level errors.
  try {
    process.exitCode = await runGoblinCommand(
      process.argv.slice(2),
      process.env,
      {
        stdout: (message) => console.log(message),
        stderr: (message) => console.error(message),
      },
      createHttpTransport(),
    )
  } catch (err) {
    console.error(`g: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  }
}
