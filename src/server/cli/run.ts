import path from 'node:path'
import { printHelp } from '#/server/cli/help.ts'
import { readPackageVersion } from '#/server/cli/package-version.ts'

// Each mode has its own process and dependencies. In particular, a PTY worker
// or `g` command must not initialize the server's repositories or schedulers.
export async function runCli(args: string[]): Promise<void> {
  if (args[0] === '--pty-worker') {
    if (!process.send) throw new Error('PTY worker requires a parent IPC channel')
    const { bootstrapPtyWorker } = await import('#/server/terminal/pty-worker-bootstrap.ts')
    bootstrapPtyWorker()
    return
  }
  if (args[0] === 'g') {
    const { runGoblinCommand } = await import('#/server/g-command/cli.ts')
    const { createHttpTransport } = await import('#/server/g-command/transport.ts')
    process.exitCode = await runGoblinCommand(
      args.slice(1),
      process.env,
      { stdout: (message) => console.log(message), stderr: (message) => console.error(message) },
      createHttpTransport(),
    )
    return
  }
  if (args.length === 0 || (args.length === 1 && (args[0] === '--help' || args[0] === '-h'))) {
    printHelp()
    return
  }
  if (args.length === 1 && (args[0] === '--version' || args[0] === '-v')) {
    console.log(readPackageVersion())
    return
  }
  if (args[0] !== 'serve' && args[0] !== 'open') {
    throw new Error(`Unknown command: ${args[0]}. Run goblin --help for usage.`)
  }
  if (args.length === 2 && (args[1] === '--help' || args[1] === '-h')) {
    printHelp()
    return
  }
  if (args[0] === 'open') {
    // Opening the browser does not initialize server repositories or workers.
    const { openGoblin } = await import('#/server/open.ts')
    await openGoblin(args.slice(1))
    return
  }
  const compiled = Bun.isStandaloneExecutable
  const root = compiled ? import.meta.dirname : path.resolve(import.meta.dirname, '../../..')
  const command = compiled ? [process.execPath] : [process.execPath, path.join(root, 'src/server/main.ts')]
  const { launchServer } = await import('#/server/launch.ts')
  await launchServer(
    { command, webRoot: path.join(root, compiled ? 'web' : 'dist/web'), version: readPackageVersion() },
    args.slice(1),
  )
}
