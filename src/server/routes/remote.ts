import {
  getServerRemotePathSuggestions,
  getServerSshHosts,
  resolveServerRemoteTarget,
  testServerRemoteRepository,
} from '#/server/modules/remote.ts'
import { createRouteApp, parseHttpInput } from '#/server/common/http-validate.ts'
import { REMOTE_PROCEDURE_SCHEMAS } from '#/shared/http-schemas.ts'

export function createRemoteRoutes() {
  const app = createRouteApp()
  app.get('/ssh-hosts', async (c) => c.json(await getServerSshHosts()))
  app.post('/resolve-target', async (c) => {
    const { alias, remotePath } = parseHttpInput(
      REMOTE_PROCEDURE_SCHEMAS.resolveTarget,
      await c.req.json().catch(() => null),
    )
    return c.json(await resolveServerRemoteTarget({ alias, remotePath }, c.req.raw.signal))
  })
  app.post('/path-suggestions', async (c) => {
    const { alias, remotePath, prefix } = parseHttpInput(
      REMOTE_PROCEDURE_SCHEMAS.pathSuggestions,
      await c.req.json().catch(() => null),
    )
    return c.json(await getServerRemotePathSuggestions({ alias, remotePath, prefix }, c.req.raw.signal))
  })
  app.post('/test-repository', async (c) => {
    const body = await c.req.json().catch(() => null)
    const { target } = parseHttpInput(REMOTE_PROCEDURE_SCHEMAS.testRepository, body)
    return c.json(await testServerRemoteRepository(target, c.req.raw.signal))
  })
  return app
}
