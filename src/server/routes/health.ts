import { getBackgroundSyncDiagnostics } from '#/server/modules/background-sync.ts'
import type { ServerAppRealtimeHost } from '#/server/realtime/app-realtime-host.ts'
import { createRouteApp } from '#/server/common/http-validate.ts'

export function createHealthRoutes(options: {
  version: string
  startedAt: number
  appRealtimeHost: ServerAppRealtimeHost
}) {
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
      terminal: (await options.appRealtimeHost.getDiagnostics()).terminal,
    }),
  )
  return app
}
