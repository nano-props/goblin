import type { MiddlewareHandler } from 'hono'

export function createInternalAuthMiddleware(secret: string): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.header('x-goblin-internal-secret') !== secret) {
      return c.json({ ok: false, message: 'Unauthorized' }, 401)
    }
    await next()
  }
}
