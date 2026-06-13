import type { Context } from 'hono'
import { IpcError, type IpcErrorCode } from '#/shared/api-types.ts'

export interface OkEnvelope<T> {
  ok: true
  data: T
}

export interface ErrorEnvelope {
  ok: false
  code: IpcErrorCode
  message: string
}

/**
 * Wrap a successful payload in the `{ ok: true, data }` envelope.
 * Most existing routes return domain-shaped payloads (e.g.
 * `{ ok: true, ... }`) directly; use this only when a route wants
 * a strict envelope.
 */
export function okJson<T>(c: Context, data: T, status: 200 | 201 | 202 = 200): Response {
  return c.json({ ok: true, data } as OkEnvelope<T>, status)
}

// Keep the same code → status mapping as the `IpcError` → HTTP
// conversion in `createRouteApp` (see http-validate.ts) so a thrown
// `IpcError` and a returned `errorJson` produce the same status.
const HTTP_STATUS_BY_IPC_CODE: Record<IpcErrorCode, number> = {
  BAD_REQUEST: 400,
  FORBIDDEN: 401,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
}

/**
 * Build a JSON error response that matches the `IpcError` envelope.
 * Centralises the (code → status) mapping so a future `IpcError`
 * variant doesn't get the wrong default in some random route.
 */
export function errorJson(c: Context, code: IpcErrorCode, message: string, status?: number): Response {
  const httpStatus = status ?? HTTP_STATUS_BY_IPC_CODE[code] ?? 400
  return c.json({ ok: false, code, message } as ErrorEnvelope, httpStatus as 400 | 401 | 404 | 500)
}

export { HTTP_STATUS_BY_IPC_CODE }

/**
 * Read the request body as JSON, distinguishing "no body / empty
 * body" from "malformed JSON". Callers usually want to pass the
 * parsed body through `parseHttpInput`; for that to give a useful
 * field-level error message the body has to be a real (possibly
 * empty) object, not a `null` stand-in.
 *
 * Returns the parsed body when it is an object or array, otherwise
 * a 400 — the schema validator will do the real shape check.
 */
export async function readJsonBody(
  c: Context,
): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  let raw: string
  try {
    raw = await c.req.text()
  } catch {
    return { ok: false, response: errorJson(c, 'BAD_REQUEST', 'Cannot read request body') }
  }
  // An empty body is legitimate for routes whose schema doesn't
  // require any input — let `parseHttpInput` produce the
  // shape-specific error in that case.
  if (raw.trim() === '') return { ok: true, body: undefined }
  try {
    return { ok: true, body: JSON.parse(raw) }
  } catch {
    return { ok: false, response: errorJson(c, 'BAD_REQUEST', 'Request body is not valid JSON') }
  }
}

/**
 * Throw an `IpcError` whose HTTP-mapped status will be picked up by
 * `createRouteApp`'s `onError`. Use when a handler wants the same
 * "IpcError → 4xx" path as `parseHttpInput` but doesn't fit the
 * "validate a body" model (e.g. bad path params, missing header).
 */
export function throwIpcHttp(code: IpcErrorCode, message: string): never {
  throw new IpcError({ code, message })
}
