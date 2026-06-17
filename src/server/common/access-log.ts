import type { MiddlewareHandler } from 'hono'
import { serverLogger } from '#/server/logger.ts'

/**
 * Per-request access log. The server was previously silent about
 * runtime traffic — only a "listening" line on boot — so a
 * misbehaving client or a slow handler was invisible. Emitted at
 * `debug` so the default `info` level stays quiet during normal
 * use; reach it by setting `GOBLIN_NODE_LOG_LEVEL=debug` when
 * debugging a slow handler or a misbehaving client.
 *
 * Static asset traffic through `serveStatic` is also logged; if
 * that becomes noisy, gate it on path prefix later.
 */
export function accessLog(): MiddlewareHandler {
  return async (c, next) => {
    const startedAt = performance.now()
    await next()
    const durationMs = Math.round((performance.now() - startedAt) * 100) / 100
    serverLogger.debug(
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
