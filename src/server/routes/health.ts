import { Hono } from 'hono'
import { getBackgroundSyncDiagnostics } from '#/server/modules/background-sync.ts'
import type { ServerTerminalHost } from '#/server/terminal/terminal-host.ts'

export function createHealthRoutes(options: { version: string; startedAt: number; terminalHost: ServerTerminalHost }) {
  const app = new Hono()
  const payload = {
    ok: true,
    service: 'goblin-server',
    version: options.version,
    startedAt: options.startedAt,
  }
  app.get('/health', (c) => c.json(payload))
  app.get('/hi', (c) => c.json(payload))
  app.get('/health/background-sync', (c) =>
    c.json({
      ...payload,
      backgroundSync: getBackgroundSyncDiagnostics(),
    }),
  )
  app.get('/health/terminal', async (c) =>
    c.json({
      ...payload,
      terminal: await options.terminalHost.getDiagnostics(),
    }),
  )
  return app
}
