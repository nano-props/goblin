import type { Context } from 'hono'
import type { CodedErrorCode } from '#/shared/coded-error.ts'

export interface ErrorEnvelope {
  ok: false
  code: CodedErrorCode | (string & {})
  message: string
}

// Keep the same code → status mapping as the `CodedError` → HTTP
// conversion in `createRouteApp` (see http-validate.ts) so a thrown
// `CodedError` and a returned `errorJson` produce the same status.
// The map is keyed by `string` (not `CodedErrorCode`) because transport
// codes like PAYLOAD_TOO_LARGE (413) exist only at the HTTP boundary.
const HTTP_STATUS_BY_ERROR_CODE: Record<string, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  UNSUPPORTED_MEDIA_TYPE: 415,
  PAYLOAD_TOO_LARGE: 413,
  INTERNAL_SERVER_ERROR: 500,
}

/**
 * Build a JSON error response that matches the `CodedError` envelope.
 * Centralises the (code → status) mapping so thrown and returned errors
 * use the same HTTP status.
 *
 * `code` is widened to `string` so transport-only codes (e.g.
 * `PAYLOAD_TOO_LARGE`) can be returned without contorting the
 * shared `CodedErrorCode` type to know about them. The status
 * map is keyed by string for the same reason.
 */
export function errorJson(
  c: Context,
  code: CodedErrorCode | (string & {}),
  message: string,
  status?: number,
): Response {
  const httpStatus = status ?? HTTP_STATUS_BY_ERROR_CODE[code] ?? 400
  // `c.json` has a narrow `ContentfulStatusCode` union that doesn't
  // cover transport codes like 413/429. Cast through `as never` to
  // keep the public signature of errorJson permissive without
  // duplicating Hono's status-code union.
  return c.json({ ok: false, code, message } as ErrorEnvelope, httpStatus as never)
}
