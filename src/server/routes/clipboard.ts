import { createRouteApp } from '#/server/common/http-validate.ts'
import { errorJson } from '#/server/common/responses.ts'
import {
  pruneExpiredClipboardTempFiles,
  pruneStaleClipboardTempDirs,
  saveClipboardFiles,
} from '#/server/modules/clipboard-write-paths.ts'
import { MAX_PASTE_UPLOAD_FILES, PASTE_FILE_MAX_BYTES, PasteFileLimitError } from '#/shared/clipboard-paste.ts'

const PASTE_UPLOAD_LIMIT_MESSAGES = {
  file: `One or more files exceed the ${PASTE_FILE_MAX_BYTES}-byte cap`,
  batch: 'Upload request is too large',
  count: `Upload contains more than ${MAX_PASTE_UPLOAD_FILES} files`,
} satisfies Record<PasteFileLimitError['kind'], string>

export function createClipboardRoutes() {
  const app = createRouteApp()
  // One-shot startup prune; routes are constructed once per server
  // process via `app-factory.ts`. Fire-and-forget — readdir/rm errors
  // are swallowed inside the module.
  void pruneStaleClipboardTempDirs()
  void pruneExpiredClipboardTempFiles()

  // Persist binary blobs from a `ClipboardEvent` / `DragEvent` on the web
  // client. Access-token authentication and the HTTP body cap are the request
  // resource boundary; this route normalises the owned repeated-`files` shape.
  app.post('/files', async (c) => {
    if (!c.req.header('content-type')?.toLowerCase().startsWith('multipart/form-data;')) {
      return errorJson(c, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be multipart/form-data')
    }
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
      if (err instanceof PasteFileLimitError) {
        return errorJson(c, 'PAYLOAD_TOO_LARGE', PASTE_UPLOAD_LIMIT_MESSAGES[err.kind])
      }
      return errorJson(c, 'INTERNAL_SERVER_ERROR', 'Failed to persist clipboard files')
    }
  })
  return app
}
