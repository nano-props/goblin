import { Hono } from 'hono'
import type { ServerTerminalHost } from '#/server/terminal/terminal-host.ts'

function clientIdFromRequest(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function createTerminalRoutes(terminalHost: ServerTerminalHost) {
  const app = new Hono()

  app.post('/attach', async (c) => {
    const body = await c.req.json().catch(() => null)
    return c.json(await terminalHost.attach(clientIdFromRequest(body?.clientId), body ?? {}))
  })

  app.post('/restart', async (c) => {
    const body = await c.req.json().catch(() => null)
    return c.json(await terminalHost.restart(clientIdFromRequest(body?.clientId), body ?? {}))
  })

  app.post('/write', async (c) => {
    const body = await c.req.json().catch(() => null)
    return c.json(await terminalHost.write(clientIdFromRequest(body?.clientId), body ?? {}))
  })

  app.post('/resize', async (c) => {
    const body = await c.req.json().catch(() => null)
    return c.json(await terminalHost.resize(clientIdFromRequest(body?.clientId), body ?? {}))
  })

  app.post('/takeover', async (c) => {
    const body = await c.req.json().catch(() => null)
    return c.json(await terminalHost.takeover(clientIdFromRequest(body?.clientId), body ?? {}))
  })

  app.post('/close', async (c) => {
    const body = await c.req.json().catch(() => null)
    return c.json(await terminalHost.close(clientIdFromRequest(body?.clientId), body ?? {}))
  })

  app.post('/notify-bell', async (c) => {
    const body = await c.req.json().catch(() => null)
    return c.json(await terminalHost.notifyBell(clientIdFromRequest(body?.clientId), body ?? {}))
  })

  app.post('/list-sessions', async (c) => {
    const body = await c.req.json().catch(() => null)
    const clientId = clientIdFromRequest(body?.clientId)
    const repoRoot = typeof body?.repoRoot === 'string' ? body.repoRoot : ''
    return c.json(await terminalHost.listSessions(clientId, repoRoot))
  })

  app.post('/create', async (c) => {
    const body = await c.req.json().catch(() => null)
    return c.json(await terminalHost.create(clientIdFromRequest(body?.clientId), body ?? {}))
  })

  app.post('/prune', async (c) => {
    const body = await c.req.json().catch(() => null)
    const clientId = clientIdFromRequest(body?.clientId)
    const repoRoot = typeof body?.repoRoot === 'string' ? body.repoRoot : ''
    return c.json(await terminalHost.prune(clientId, repoRoot))
  })

  app.post('/session-snapshot', async (c) => {
    const body = await c.req.json().catch(() => null)
    return c.json(await terminalHost.getSessionSnapshot(clientIdFromRequest(body?.clientId), body ?? {}))
  })

  return app
}
