import { getBackgroundSyncDiagnostics } from '#/server/modules/background-sync.ts'
import type { ServerRealtimeHost } from '#/server/terminal/terminal-host.ts'
import { createRouteApp } from '#/server/common/http-validate.ts'

export function createHealthRoutes(options: { version: string; startedAt: number; terminalHost: ServerRealtimeHost }) {
  const app = createRouteApp()
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
