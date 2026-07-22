import * as v from 'valibot'
import { Hono } from 'hono'
import { IpcError } from '#/shared/api-types.ts'
import { serverLogger } from '#/server/logger.ts'
import { OperationCancelledError } from '#/shared/operation-cancelled.ts'
import { errorJson } from '#/server/common/responses.ts'

/**
 * Parse a request body against a valibot schema. Throws `IpcError` with
 * `code: 'BAD_REQUEST'` when the shape is invalid; the Hono error handler in
 * `app-factory.ts` converts that into a 400 JSON response.
 *
 * Mirrors `parseIpcInput` in `#/shared/api-types.ts` so HTTP routes and the
 * native bridge can share the same valibot schema registry.
 */
export function parseHttpInput<T>(schema: v.GenericSchema<unknown, T>, input: unknown): T {
  const parsed = v.safeParse(schema, input)
  if (!parsed.success) throw new IpcError({ code: 'BAD_REQUEST', message: formatHttpValidationError(parsed.issues) })
  return parsed.output
}

/**
 * Read the request body as JSON and validate it in one call. On
 * either failure (malformed JSON, shape mismatch) an `IpcError` is
 * thrown that `createRouteApp`'s `onError` converts into a 400 JSON
 * response. Empty bodies are passed through as `undefined` so the
 * schema decides whether the route accepts them.
 */
export async function parseHttpBody<T>(
  schema: v.GenericSchema<unknown, T>,
  c: { req: { header(name: string): string | undefined; text(): Promise<string> } },
): Promise<T> {
  if (!isJsonContentType(c.req.header('content-type'))) {
    throw new IpcError({ code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Content-Type must be application/json' })
  }
  const raw = await c.req.text()
  if (raw.trim() === '') return parseHttpInput(schema, undefined)
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(raw)
  } catch {
    throw new IpcError({ code: 'BAD_REQUEST', message: 'Request body is not valid JSON' })
  }
  return parseHttpInput(schema, parsedJson)
}

export function isJsonContentType(value: string | undefined): boolean {
  return value?.split(';', 1)[0]?.trim().toLowerCase() === 'application/json'
}

function formatHttpValidationError(issues: ReadonlyArray<v.BaseIssue<unknown>>): string {
  return issues
    .map((issue) => {
      const path = v.getDotPath(issue) ?? '<root>'
      return `${path}: ${issue.message}`
    })
    .join('; ')
}

/**
 * Create a Hono sub-app that converts `IpcError` thrown from any handler
 * (e.g. via `parseHttpInput`) into a JSON response with the right HTTP
 * status code. Use this from each `createXxxRoutes` factory so route
 * factories stay testable in isolation.
 */
export function createRouteApp(): Hono {
  const app = new Hono()
  app.onError((err, c) => {
    if (err instanceof IpcError) return errorJson(c, err.code, err.message)
    if (err instanceof OperationCancelledError || c.req.raw.signal.aborted) {
      serverLogger.debug({ path: c.req.path }, 'request cancelled after client disconnect')
      return new Response(null, { status: 499 })
    }
    serverLogger.error({ err }, 'unhandled error')
    return errorJson(c, 'INTERNAL_SERVER_ERROR', 'Internal server error')
  })
  return app
}
