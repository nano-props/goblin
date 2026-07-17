#!/usr/bin/env node
/**
 * This script MUST be executed with Node.js (not bun or other runtimes).
 * Using bun or other runtimes may cause terminal functionality issues due to the node-pty library,
 * which is a native module that requires Node.js and is not compatible with bun or other runtimes.
 * Node.js version must be 24 or higher.
 * Run with: node scripts/start-server.ts
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import qrcode from 'qrcode'
import { bootstrapServer } from '#/server/bootstrap.ts'
import { serverDataDir } from '#/shared/data-dir.ts'
import { readOrCreateAccessToken } from '#/shared/access-token-file.ts'
import { getLanUrls, isLanAddress } from '#/shared/lan-addresses.ts'
import { prepareNodePtyDarwinRuntime } from '#/system/node-pty-runtime.ts'

const repoRoot = path.resolve(import.meta.dirname, '..')
process.chdir(repoRoot)
prepareNodePtyDarwinRuntime({
  packageRoot: path.join(repoRoot, 'node_modules/node-pty'),
})

const { values } = parseArgs({
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

// Resolve (and persist on first run) the access token *before* spawning
// the server. The server's own bootstrap re-reads the file unless
// `GOBLIN_SERVER_ACCESS_TOKEN` is set, so we pass the token via env so
// the server's startup log doesn't double-print and so the value
// printed here matches the in-memory value the server uses.
const accessToken = values.token?.trim() || (await readOrCreateAccessToken(serverDataDir()))
process.env.GOBLIN_SERVER_ACCESS_TOKEN = accessToken

if (!process.env.npm_package_version?.trim()) {
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as { version?: string }
  process.env.npm_package_version = pkg.version?.trim() || '0.1.0'
}

const webIndex = path.join(repoRoot, 'dist/web/index.html')
const webBoot = path.join(repoRoot, 'dist/web/boot.js')
const webReady = existsSync(webIndex) && existsSync(webBoot)
const sourceGCommandEntry = path.join(repoRoot, 'src/server/entrypoints/g-command.ts')
const server = await bootstrapServer({
  // This wrapper is the source-mode server launcher. Do not auto-detect
  // dist/server artifacts here: stale builds would silently change which
  // server-side code this command runs.
  gCommandEntry: sourceGCommandEntry,
})

console.log(`[embedded-server] listening on http://${server.hostname}:${server.port}`)
console.log(`[embedded-server] data dir: ${serverDataDir()}`)
// The token is the single piece of info a browser / LAN client needs.
// It's printed once on stdout; the file at `<dataDir>/server-token`
// holds the same value persistently, so subsequent boots reuse it.
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

for (const url of lanUrls) {
  // Embed the access token in the URL so scanning the QR auto-fills
  // the gate on the phone. The page consumes the token on first load
  // (POST `/api/login` → Set-Cookie → strip from URL); the Referer
  // / history leak window is the few milliseconds between page load
  // and the `history.replaceState` call. Acceptable for a single-user
  // LAN tool with a 128-bit, ephemeral, 1-year-cookie token.
  const urlWithToken = `${url.replace(/\/$/, '')}/?accessToken=${encodeURIComponent(accessToken)}`
  console.log(`[embedded-server] LAN URL: ${urlWithToken}`)
  try {
    const qr = await qrcode.toString(urlWithToken, { type: 'terminal', small: true })
    console.log(qr)
  } catch {
    console.warn(`[embedded-server] failed to generate QR code for ${urlWithToken}`)
  }
}

if (!webReady) {
  console.warn('[embedded-server] web assets missing; run `bun run build:web` for the web UI')
}
