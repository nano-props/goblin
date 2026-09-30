import path from 'node:path'
import { fileURLToPath } from 'node:url'
import packageJson from '../../../package.json' with { type: 'json' }

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
  const standalone = Bun.isStandaloneExecutable
  const root = standalone ? import.meta.dirname : path.resolve(import.meta.dirname, '../../..')
  const command = standalone ? [process.execPath] : [process.execPath, fileURLToPath(import.meta.url)]
  const { launchStandaloneServer } = await import('#/server/standalone/standalone-launch.ts')
  await launchStandaloneServer(
    { command, webRoot: path.join(root, standalone ? 'web' : 'dist/web'), version: packageJson.version },
    args,
  )
}

if (import.meta.main) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
