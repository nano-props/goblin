/**
 * Web-only backend for `saveClipboardFiles`. Posts a multipart body to
 * the server's `/api/clipboard/files` route; the server writes blobs
 * under `<serverDataDir()>/clipboard-tmp-<pid>/` and returns absolute
 * paths the PTY can read.
 *
 * Returns `[]` on any failure (network, non-2xx, malformed JSON). The
 * resolver counts those as backend transfer failures for the terminal toast.
 */
import { CLIPBOARD_FALLBACK_FILE_NAME } from '#/shared/clipboard-paste.ts'
import { ACCESS_TOKEN_HEADER } from '#/shared/access-token.ts'

export interface HttpClipboardBackendConfig {
  /** Bootstrap-derived server origin, e.g. `http://127.0.0.1:32100/`. */
  url: string
  /**
   * Bootstrap-derived access token. When present (embedded client
   * or Vite dev), sent as the access-token header. When
   * absent (standalone browser), the request is sent without the
   * header and relies on the http-only cookie set by `POST /api/login`.
   */
  accessToken: string
}

export function createHttpClipboardBackend(config: HttpClipboardBackendConfig): {
  saveClipboardFiles(files: File[]): Promise<string[]>
} {
  return {
    async saveClipboardFiles(files: File[]): Promise<string[]> {
      if (files.length === 0) return []
      const form = new FormData()
      for (const file of files) {
        // Clipboard blobs synthesised from `clipboardData.items` have an
        // empty `file.name`. Multipart requires a filename for `File`
        // parts, so fall back to the runtime-shared placeholder — the
        // server's sanitiser preserves this literal (it contains no
        // Windows-reserved characters).
        const filename = file.name.length > 0 ? file.name : CLIPBOARD_FALLBACK_FILE_NAME
        form.append('files', file, filename)
      }
      try {
        const endpoint = new URL('api/clipboard/files', config.url)
        const headers: Record<string, string> = {}
        if (config.accessToken) headers[ACCESS_TOKEN_HEADER] = config.accessToken
        const res = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: form,
          // `credentials: 'include'` carries the cookie on cross-origin
          // LAN requests; for same-origin it's a no-op.
          credentials: 'include',
        })
        if (!res.ok) return []
        const json = (await res.json()) as { paths?: unknown }
        if (!Array.isArray(json.paths)) return []
        return json.paths.filter((p): p is string => typeof p === 'string')
      } catch {
        return []
      }
    },
  }
}
