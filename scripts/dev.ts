#!/usr/bin/env bun
import path from 'node:path'
import { execa } from 'execa'

const repoRoot = path.resolve(import.meta.dirname, '..')
const webHost = process.env.GOBLIN_WEB_DEV_HOST?.trim() || '127.0.0.1'
const webPort = process.env.GOBLIN_WEB_DEV_PORT?.trim() || '5173'
const serverHost = process.env.GOBLIN_SERVER_HOST?.trim() || '127.0.0.1'
const serverPort = process.env.GOBLIN_SERVER_PORT?.trim() || '32100'
const options = {
  cwd: repoRoot,
  stdio: 'inherit',
  env: { GOBLIN_SERVER_HOST: serverHost, GOBLIN_SERVER_PORT: serverPort },
  reject: false,
} as const

const server = execa(process.execPath, ['--watch', 'src/server/main.ts', 'serve'], options)
const web = execa('vite', ['--host', webHost, '--port', webPort, '--strictPort'], { ...options, preferLocal: true })
console.log(`[dev] Open http://${webHost}:${webPort}; use the access token printed by the server.`)

let stopping = false
function stop(): void {
  if (stopping) return
  stopping = true
  server.kill('SIGTERM')
  web.kill('SIGTERM')
}
process.once('SIGINT', stop)
process.once('SIGTERM', stop)

try {
  const result = await Promise.race([server, web])
  if (!stopping) process.exitCode = result.exitCode ?? 1
} finally {
  stop()
  await Promise.allSettled([server, web])
}
