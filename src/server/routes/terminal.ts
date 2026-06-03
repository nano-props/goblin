import { Hono } from 'hono'
import {
  attachServerTerminal,
  closeServerTerminal,
  createServerTerminal,
  getServerTerminalSessionSnapshot,
  listServerTerminalSessions,
  notifyServerTerminalBell,
  pruneServerTerminals,
  resizeServerTerminal,
  restartServerTerminal,
  takeoverServerTerminal,
  writeServerTerminal,
} from '#/server/modules/terminal.ts'

function clientIdFromRequest(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function createTerminalRoutes() {
  const app = new Hono()

  app.post('/attach', async (c) => {
    const body = await c.req.json().catch(() => null)
    return c.json(await attachServerTerminal(clientIdFromRequest(body?.clientId), body ?? {}))
  })

  app.post('/restart', async (c) => {
    const body = await c.req.json().catch(() => null)
    return c.json(await restartServerTerminal(clientIdFromRequest(body?.clientId), body ?? {}))
  })

  app.post('/write', async (c) => {
    const body = await c.req.json().catch(() => null)
    return c.json(writeServerTerminal(clientIdFromRequest(body?.clientId), body ?? {}))
  })

  app.post('/resize', async (c) => {
    const body = await c.req.json().catch(() => null)
    return c.json(resizeServerTerminal(clientIdFromRequest(body?.clientId), body ?? {}))
  })

  app.post('/takeover', async (c) => {
    const body = await c.req.json().catch(() => null)
    return c.json(takeoverServerTerminal(clientIdFromRequest(body?.clientId), body ?? {}))
  })

  app.post('/close', async (c) => {
    const body = await c.req.json().catch(() => null)
    return c.json(closeServerTerminal(clientIdFromRequest(body?.clientId), body ?? {}))
  })

  app.post('/notify-bell', async (c) => {
    const body = await c.req.json().catch(() => null)
    return c.json(notifyServerTerminalBell(clientIdFromRequest(body?.clientId), body ?? {}))
  })

  app.post('/list-sessions', async (c) => {
    const body = await c.req.json().catch(() => null)
    const clientId = clientIdFromRequest(body?.clientId)
    const repoRoot = typeof body?.repoRoot === 'string' ? body.repoRoot : ''
    return c.json(await listServerTerminalSessions(clientId, repoRoot))
  })

  app.post('/create', async (c) => {
    const body = await c.req.json().catch(() => null)
    return c.json(await createServerTerminal(clientIdFromRequest(body?.clientId), body ?? {}))
  })

  app.post('/prune', async (c) => {
    const body = await c.req.json().catch(() => null)
    const clientId = clientIdFromRequest(body?.clientId)
    const repoRoot = typeof body?.repoRoot === 'string' ? body.repoRoot : ''
    return c.json(await pruneServerTerminals(clientId, repoRoot))
  })

  app.post('/session-snapshot', async (c) => {
    const body = await c.req.json().catch(() => null)
    return c.json(await getServerTerminalSessionSnapshot(clientIdFromRequest(body?.clientId), body ?? {}))
  })

  return app
}
