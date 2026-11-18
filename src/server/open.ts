import path from 'node:path'
import { parseArgs } from 'node:util'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import * as v from 'valibot'
import { formatServerUrl } from '#/shared/server-url.ts'
import { WorkspaceOpenPathSchema } from '#/shared/workspace-open-url.ts'

export async function openGoblin(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: { host: { type: 'string' }, port: { type: 'string' }, url: { type: 'string' } },
    strict: true,
    allowPositionals: true,
  })
  if (positionals.length > 1) throw new Error('Usage: goblin open [directory] [options]')
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    throw new Error('Goblin requires Linux or macOS')
  }
  const directory = v.parse(WorkspaceOpenPathSchema, path.resolve(positionals[0] ?? '.'))
  if (values.url !== undefined && (values.host !== undefined || values.port !== undefined)) {
    throw new Error('Use --url by itself or specify --host and --port.')
  }
  const host = values.host?.trim() || process.env.GOBLIN_SERVER_HOST?.trim() || '127.0.0.1'
  const port = values.port?.trim() || process.env.GOBLIN_SERVER_PORT?.trim() || '32100'
  const origin = values.url === undefined ? formatServerUrl(host, port) : parseOpenOrigin(values.url)
  const url = new URL('/open', origin)
  url.searchParams.set('path', directory)
  try {
    const launcher = spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url.href], {
      detached: true,
      stdio: 'ignore',
    })
    // The launcher may stay alive for the browser's lifetime. Only wait for startup.
    await once(launcher, 'spawn')
    launcher.unref()
  } catch {
    throw new Error(`Could not launch the browser. Open ${url.href} manually.`)
  }
  console.log(url.href)
}

function parseOpenOrigin(value: string): string {
  const address = value.trim()
  const url = URL.parse(address)
  if (!url || !/^https?:\/\/[^/?#\\@\s]+\/?$/i.test(address) || url.pathname !== '/') {
    throw new Error('Provide an HTTP or HTTPS server origin for --url, for example https://example.com.')
  }
  return url.origin
}
