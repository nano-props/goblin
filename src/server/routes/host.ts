import { createRouteApp } from '#/server/common/http-validate.ts'
import { getServerHostInfo, type HostInfo } from '#/server/host-info.ts'

/** Public host facts needed for platform-aware UI before authentication. */
export function createHostRoutes() {
  const app = createRouteApp()
  app.get('/', (c) => c.json(getServerHostInfo() satisfies HostInfo))
  return app
}
