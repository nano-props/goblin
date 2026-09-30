import { runCli } from '#/server/cli/run.ts'

if (import.meta.main) {
  void runCli(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
