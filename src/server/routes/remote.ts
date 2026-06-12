import { Hono } from 'hono'
import {
  getServerRemotePathSuggestions,
  getServerSshHosts,
  resolveServerRemoteTarget,
  testServerRemoteRepository,
} from '#/server/modules/remote.ts'
import { normalizeRemoteTarget } from '#/shared/remote-repo.ts'

export function createRemoteRoutes() {
  const app = new Hono()
  app.get('/ssh-hosts', async (c) => c.json(await getServerSshHosts()))
  app.post('/resolve-target', async (c) => {
    const body = await c.req.json().catch(() => null)
    const input = {
      alias: typeof body?.alias === 'string' ? body.alias : '',
      remotePath: typeof body?.remotePath === 'string' ? body.remotePath : '',
    }
    // resolveServerRemoteTarget already returns { target } | { error }
    // for every failure mode (config-changed, home-unavailable, etc.) —
    // no try/catch needed at the route layer.
    return c.json(await resolveServerRemoteTarget(input, c.req.raw.signal))
  })
  app.post('/path-suggestions', async (c) => {
    const body = await c.req.json().catch(() => null)
    const input = {
      alias: typeof body?.alias === 'string' ? body.alias : '',
      remotePath: typeof body?.remotePath === 'string' ? body.remotePath : '',
      prefix: typeof body?.prefix === 'string' ? body.prefix : '',
    }
    return c.json(await getServerRemotePathSuggestions(input, c.req.raw.signal))
  })
  app.post('/test-repository', async (c) => {
    const body = await c.req.json().catch(() => null)
    const target = normalizeRemoteTarget(body?.target)
    // testServerRemoteRepository returns a structured failure diagnostic
    // on every error path, so no fallback here. Throwing 'Invalid remote
    // repository target' remains a 500 because it indicates a malformed
    // renderer-side request, not a runtime condition.
    return c.json(await testServerRemoteRepository(target ?? (body?.target as never), c.req.raw.signal))
  })
  return app
}
