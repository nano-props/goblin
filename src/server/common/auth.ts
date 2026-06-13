import type { MiddlewareHandler } from 'hono'
import { safeEqualString } from '#/server/common/timing-safe.ts'
import { errorJson } from '#/server/common/responses.ts'

export function createInternalAuthMiddleware(secret: string): MiddlewareHandler {
  return async (c, next) => {
    if (!safeEqualString(c.req.header('x-goblin-internal-secret') ?? '', secret)) {
      return errorJson(c, 'FORBIDDEN', 'Unauthorized')
    }
    await next()
  }
}
