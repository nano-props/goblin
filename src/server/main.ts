import path from 'node:path'
import { fileURLToPath } from 'node:url'
import packageJson from '../../package.json' with { type: 'json' }

// Each mode has its own process and dependencies. In particular, a PTY worker
// or `g` command must not initialize the server's repositories or schedulers.
async function main(): Promise<void> {
  const args = process.argv.slice(2)
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
    console.log(packageJson.version)
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
  const root = compiled ? import.meta.dirname : path.resolve(import.meta.dirname, '../..')
  const command = compiled ? [process.execPath] : [process.execPath, fileURLToPath(import.meta.url)]
  const { launchServer } = await import('#/server/launch.ts')
  await launchServer(
    { command, webRoot: path.join(root, compiled ? 'web' : 'dist/web'), version: packageJson.version },
    args.slice(1),
  )
}

function printHelp(): void {
  console.log(`Goblin — Workspace Manager

Usage: goblin <command> [options]

Commands:
  serve                 Start the server
  open [directory]      Open a workspace in your browser (default: current directory)

Options:
  -h, --help            Show this help (also available for each command)
  -v, --version         Print the version

serve options:
  --host <host>         Bind address (default: 127.0.0.1)
  --port <port>         Listen port (default: 32100)
  --data-dir <path>     Application data directory
  --token <token>       Use an explicit access token

open options:
  --host <host>         Server address (default: 127.0.0.1)
  --port <port>         Server port (default: 32100)

Both commands respect GOBLIN_SERVER_HOST and GOBLIN_SERVER_PORT.
Running goblin without a command shows help; it does not start a server.`)
}

if (import.meta.main) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
