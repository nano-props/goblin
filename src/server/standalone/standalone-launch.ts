import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { bootstrapServer, type BootstrappedServer } from '#/server/bootstrap.ts'
import { resolveGoblinCommandEntry } from '#/server/terminal/g-command.ts'
import { resolvePtyWorkerEntry } from '#/server/terminal/pty-worker-entry.ts'
import { readOrCreateAccessToken } from '#/shared/access-token-file.ts'
import { serverDataDir } from '#/shared/data-dir.ts'
import { getLanUrls, isLanAddress } from '#/shared/lan-addresses.ts'
import { prepareNodePtyDarwinRuntime } from '#/system/node-pty-runtime.ts'

export interface StandaloneServerLayout {
  repoRoot: string
  runtimeEntryDir: string
}

export async function launchStandaloneServer(
  layout: StandaloneServerLayout,
  args: string[] = process.argv.slice(2),
  fileExists: typeof existsSync = existsSync,
): Promise<BootstrappedServer> {
  process.chdir(layout.repoRoot)
  prepareNodePtyDarwinRuntime({
    packageRoot: path.join(layout.repoRoot, 'node_modules/node-pty'),
  })

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
  if (values['data-dir']?.trim()) process.env.GOBLIN_SERVER_DATA_DIR = values['data-dir'].trim()

  // Resolve the printable token before bootstrap, then project that exact
  // value into the server process so its in-memory auth boundary cannot drift
  // from the standalone login instructions.
  const accessToken = values.token?.trim() || (await readOrCreateAccessToken(serverDataDir()))
  process.env.GOBLIN_SERVER_ACCESS_TOKEN = accessToken

  if (!process.env.npm_package_version?.trim()) {
    const pkg = JSON.parse(readFileSync(path.join(layout.repoRoot, 'package.json'), 'utf8')) as { version?: string }
    process.env.npm_package_version = pkg.version?.trim() || '0.1.0'
  }

  const webIndex = path.join(layout.repoRoot, 'dist/web/index.html')
  const webBoot = path.join(layout.repoRoot, 'dist/web/boot.js')
  const webReady = fileExists(webIndex) && fileExists(webBoot)
  const server = await bootstrapServer({
    ptyWorkerEntry: resolvePtyWorkerEntry(layout.runtimeEntryDir),
    gCommandEntry: resolveGoblinCommandEntry(layout.runtimeEntryDir),
  })

  console.log(`[embedded-server] listening on http://${server.hostname}:${server.port}`)
  console.log(`[embedded-server] data dir: ${serverDataDir()}`)
  console.log(`[embedded-server] access token: ${accessToken}`)
  console.log(
    `[embedded-server] open the app at http://${server.hostname}:${server.port}/ and paste the token into the gate.`,
  )

  const lanUrls: string[] =
    server.hostname === '0.0.0.0'
      ? getLanUrls(server.port)
      : isLanAddress(server.hostname)
        ? [`http://${server.hostname}:${server.port}`]
        : []

  if (lanUrls.length > 0) {
    for (const url of lanUrls) {
      // The page consumes this token immediately through POST /api/login and
      // removes it from the address bar. This matches the existing standalone
      // LAN login contract.
      const urlWithToken = `${url.replace(/\/$/, '')}/?accessToken=${encodeURIComponent(accessToken)}`
      console.log(`[embedded-server] LAN URL: ${urlWithToken}`)
      try {
        // LAN-only presentation dependency. The standalone build keeps qrcode
        // external so localhost-only servers do not parse or retain it.
        const { default: qrcode } = await import('qrcode')
        const qr = await qrcode.toString(urlWithToken, { type: 'terminal', small: true })
        console.log(qr)
      } catch {
        console.warn(`[embedded-server] failed to generate QR code for ${urlWithToken}`)
      }
    }
  }

  if (!webReady) {
    console.warn('[embedded-server] web assets missing; run `bun run build:web` for the web UI')
  }
  return server
}
