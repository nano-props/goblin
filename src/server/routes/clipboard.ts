import { createRouteApp } from '#/server/common/http-validate.ts'
import { errorJson } from '#/server/common/responses.ts'
import {
  pruneStaleClipboardTempDirs,
  saveClipboardFiles,
} from '#/server/modules/clipboard-write-paths.ts'
import { PASTE_FILE_MAX_BYTES } from '#/shared/clipboard-paste.ts'

export function createClipboardRoutes() {
  const app = createRouteApp()
  // One-shot startup prune; routes are constructed once per server
  // process via `app-factory.ts`. Fire-and-forget — readdir/rm errors
  // are swallowed inside the module.
  void pruneStaleClipboardTempDirs()

  // Persist binary blobs from a `ClipboardEvent` / `DragEvent` on the
  // web renderer. The multipart body shape is fixed (repeated `files`),
  // so no valibot schema is needed — we normalise Hono's
  // `Record<string, string | File | (string | File)[]>` to a `File[]`
  // and hand it to the write-paths module.
  app.post('/files', async (c) => {
    let body: Record<string, string | File | (string | File)[]>
    try {
      body = await c.req.parseBody({ all: true })
    } catch {
      return errorJson(c, 'BAD_REQUEST', 'Invalid multipart body')
    }
    const raw = body.files
    const candidates: (string | File)[] = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]
    const files: File[] = []
    for (const entry of candidates) {
      if (typeof entry === 'string') {
        return errorJson(c, 'BAD_REQUEST', '`files` field must be binary, not text')
      }
      files.push(entry)
    }
    if (files.length === 0) {
      return errorJson(c, 'BAD_REQUEST', '`files` field is missing')
    }
    try {
      const { paths } = await saveClipboardFiles(files)
      return c.json({ paths })
    } catch (err) {
      if (err instanceof Error && /exceeds/.test(err.message)) {
        return errorJson(
          c,
          'PAYLOAD_TOO_LARGE',
          `One or more files exceed the ${PASTE_FILE_MAX_BYTES}-byte cap`,
        )
      }
      return errorJson(c, 'INTERNAL_SERVER_ERROR', 'Failed to persist clipboard files')
    }
  })
  return app
}
