#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { randomBytes } from 'node:crypto'
import { bootstrapServer } from '#/server/main.ts'
import { serverDataDir } from '#/server/common/data-dir.ts'

const repoRoot = path.resolve(import.meta.dirname, '..')
process.chdir(repoRoot)

const { values } = parseArgs({
  options: {
    host: { type: 'string' },
    port: { type: 'string' },
    'data-dir': { type: 'string' },
    secret: { type: 'string' },
  },
  strict: true,
})

if (values.host?.trim()) process.env.GOBLIN_SERVER_HOST = values.host.trim()
if (values.port?.trim()) process.env.GOBLIN_SERVER_PORT = values.port.trim()
if (values['data-dir']?.trim()) process.env.GOBLIN_SERVER_DATA_DIR = values['data-dir'].trim()
if (values.secret?.trim()) process.env.GOBLIN_SERVER_INTERNAL_SECRET = values.secret.trim()
if (!process.env.GOBLIN_SERVER_INTERNAL_SECRET?.trim()) {
  process.env.GOBLIN_SERVER_INTERNAL_SECRET = randomBytes(32).toString('hex')
}
if (!process.env.npm_package_version?.trim()) {
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as { version?: string }
  process.env.npm_package_version = pkg.version?.trim() || '0.1.0'
}

const webIndex = path.join(repoRoot, 'dist/web/index.html')
const webBoot = path.join(repoRoot, 'dist/web/boot.js')
const webReady = existsSync(webIndex) && existsSync(webBoot)
const server = bootstrapServer()

console.log(`[embedded-server] listening on http://${server.hostname}:${server.port}`)
console.log(`[embedded-server] data dir: ${serverDataDir()}`)
console.log(`[embedded-server] internal secret: ${process.env.GOBLIN_SERVER_INTERNAL_SECRET}`)
if (!webReady) {
  console.warn('[embedded-server] web assets missing; run `bun run build:web` for the web UI')
}
