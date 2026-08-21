import type { MiddlewareHandler } from 'hono'
import { serverNodeLog } from '#/node/logger.ts'

/** Per-request timing at debug level, including static asset traffic. */
export function accessLog(): MiddlewareHandler {
  return async (c, next) => {
    const startedAt = performance.now()
    await next()
    const durationMs = Math.round((performance.now() - startedAt) * 100) / 100
    serverNodeLog.debug(
      {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs,
      },
      'request',
    )
  }
}
