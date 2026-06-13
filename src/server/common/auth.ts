import type { MiddlewareHandler } from 'hono'
import { safeEqualString } from '#/server/common/timing-safe.ts'

export function createInternalAuthMiddleware(secret: string): MiddlewareHandler {
  return async (c, next) => {
    if (!safeEqualString(c.req.header('x-goblin-internal-secret') ?? '', secret)) {
      return c.json({ ok: false, message: 'Unauthorized' }, 401)
    }
    await next()
  }
}
