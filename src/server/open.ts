import path from 'node:path'
import { parseArgs } from 'node:util'
import { execa } from 'execa'
import * as v from 'valibot'
import { formatServerUrl } from '#/shared/server-url.ts'
import { WorkspaceOpenPathSchema } from '#/shared/workspace-open-url.ts'

export async function openGoblin(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: { host: { type: 'string' }, port: { type: 'string' } },
    strict: true,
    allowPositionals: true,
  })
  if (positionals.length > 1) throw new Error('Usage: goblin open [directory] [options]')
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    throw new Error('Goblin requires Linux or macOS')
  }
  const directory = v.parse(WorkspaceOpenPathSchema, path.resolve(positionals[0] ?? '.'))
  const host = values.host?.trim() || process.env.GOBLIN_SERVER_HOST?.trim() || '127.0.0.1'
  const port = values.port?.trim() || process.env.GOBLIN_SERVER_PORT?.trim() || '32100'
  const url = new URL('/open', formatServerUrl(host, port))
  url.searchParams.set('path', directory)
  try {
    await execa(process.platform === 'darwin' ? 'open' : 'xdg-open', [url.href])
  } catch {
    throw new Error(`Could not launch the browser. Open ${url.href} manually.`)
  }
  console.log(url.href)
}
