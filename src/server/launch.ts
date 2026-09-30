import { existsSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { bootstrapServer, type BootstrappedServer } from '#/server/bootstrap.ts'
import { createGoblinCommandLauncher } from '#/server/terminal/g-command.ts'
import { readOrCreateAccessToken } from '#/shared/access-token-file.ts'
import { serverDataDir } from '#/shared/data-dir.ts'
import { getLanUrls, isLanAddress } from '#/shared/lan-addresses.ts'

export interface ServerLaunchLayout {
  command: readonly string[]
  webRoot: string
  version: string
}

export async function launchServer(
  layout: ServerLaunchLayout,
  args: string[] = process.argv.slice(2),
): Promise<BootstrappedServer> {
  if (process.platform !== 'linux' && process.platform !== 'darwin')
    throw new Error('Goblin requires Linux or macOS (Bun PTY)')
  const { values } = parseArgs({
    args,
    options: {
      host: { type: 'string' },
      port: { type: 'string' },
      'data-dir': { type: 'string' },
      token: { type: 'string' },
    },
    strict: true,
  })
  if (values.host?.trim()) process.env.GOBLIN_SERVER_HOST = values.host.trim()
  if (values.port?.trim()) process.env.GOBLIN_SERVER_PORT = values.port.trim()
  if (values['data-dir']?.trim()) process.env.GOBLIN_SERVER_DATA_DIR = path.resolve(values['data-dir'].trim())
  const accessToken = values.token?.trim() || (await readOrCreateAccessToken(serverDataDir()))
  process.env.GOBLIN_SERVER_ACCESS_TOKEN = accessToken
  const launcher = createGoblinCommandLauncher(layout.command)
  process.once('exit', launcher.dispose)
  const disposeLauncher = () => {
    process.removeListener('exit', launcher.dispose)
    launcher.dispose()
  }
  try {
    const server = await bootstrapServer({
      workerCommand: [...layout.command, '--pty-worker'],
      gCommandBinDir: launcher.binDir,
      webRoot: layout.webRoot,
      version: layout.version,
    })
    console.log(`[server] listening on http://${server.hostname}:${server.port}`)
    console.log(`[server] data dir: ${serverDataDir()}`)
    console.log(`[server] access token: ${accessToken}`)
    console.log(`[server] open the browser URL and paste the token into the login gate.`)
    const lanUrls =
      server.hostname === '0.0.0.0'
        ? getLanUrls(server.port)
        : isLanAddress(server.hostname)
          ? [`http://${server.hostname}:${server.port}`]
          : []
    for (const url of lanUrls) {
      const urlWithToken = `${url.replace(/\/$/, '')}/?accessToken=${encodeURIComponent(accessToken)}`
      console.log(`[server] LAN URL: ${urlWithToken}`)
      try {
        // QR rendering is only needed when advertising LAN access.
        const { default: qrcode } = await import('qrcode')
        console.log(await qrcode.toString(urlWithToken, { type: 'terminal', small: true }))
      } catch {
        console.warn('[server] failed to generate LAN QR code')
      }
    }
    if (!existsSync(path.join(layout.webRoot, 'index.html')) || !existsSync(path.join(layout.webRoot, 'boot.js')))
      console.warn('[server] web assets missing; run `bun run build:web` for the web UI')
    return {
      hostname: server.hostname,
      port: server.port,
      async stop() {
        try {
          await server.stop()
        } finally {
          disposeLauncher()
        }
      },
    }
  } catch (error) {
    disposeLauncher()
    throw error
  }
}
