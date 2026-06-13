import type { Context } from 'hono'
import type { IpcErrorCode } from '#/shared/api-types.ts'

export interface ErrorEnvelope {
  ok: false
  code: IpcErrorCode | (string & {})
  message: string
}

// Keep the same code → status mapping as the `IpcError` → HTTP
// conversion in `createRouteApp` (see http-validate.ts) so a thrown
// `IpcError` and a returned `errorJson` produce the same status.
// The map is keyed by `string` (not `IpcErrorCode`) because transport
// codes like PAYLOAD_TOO_LARGE (413) are not in the shared IPC
// error enum — they only exist at the HTTP boundary.
const HTTP_STATUS_BY_IPC_CODE: Record<string, number> = {
  BAD_REQUEST: 400,
  FORBIDDEN: 401,
  NOT_FOUND: 404,
  PAYLOAD_TOO_LARGE: 413,
  INTERNAL_SERVER_ERROR: 500,
}

/**
 * Build a JSON error response that matches the `IpcError` envelope.
 * Centralises the (code → status) mapping so a future `IpcError`
 * variant doesn't get the wrong default in some random route.
 *
 * `code` is widened to `string` so transport-only codes (e.g.
 * `PAYLOAD_TOO_LARGE`) can be returned without contorting the
 * shared `IpcErrorCode` type to know about them. The status
 * map is keyed by string for the same reason.
 */
export function errorJson(c: Context, code: IpcErrorCode | (string & {}), message: string, status?: number): Response {
  const httpStatus = status ?? HTTP_STATUS_BY_IPC_CODE[code] ?? 400
  // `c.json` has a narrow `ContentfulStatusCode` union that doesn't
  // cover transport codes like 413/429. Cast through `as never` to
  // keep the public signature of errorJson permissive without
  // duplicating Hono's status-code union.
  return c.json({ ok: false, code, message } as ErrorEnvelope, httpStatus as never)
}

export { HTTP_STATUS_BY_IPC_CODE }
