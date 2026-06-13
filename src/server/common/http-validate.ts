import * as v from 'valibot'
import { Hono } from 'hono'
import { IpcError } from '#/shared/api-types.ts'
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
  return parsed.output as T
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
  c: { req: { text(): Promise<string> } },
): Promise<T> {
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

export function parseHttpQuery<T>(schema: v.GenericSchema<unknown, T>, c: { req: { url: string } }): T {
  const params = new URL(c.req.url).searchParams
  const obj: Record<string, string | string[]> = {}
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key)
    obj[key] = values.length > 1 ? values : values[0]!
  }
  const parsed = v.safeParse(schema, obj)
  if (!parsed.success) throw new IpcError({ code: 'BAD_REQUEST', message: formatHttpValidationError(parsed.issues) })
  return parsed.output as T
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
    console.error('[server] unhandled error', err)
    return errorJson(c, 'INTERNAL_SERVER_ERROR', 'Internal server error')
  })
  return app
}
