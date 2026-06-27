/**
 * Per-file ceiling for clipboard paste / drop into the terminal session.
 *
 * Read by:
 * - `TerminalSessionView` paste / drop handlers (client): early bail-out with
 *   `terminal.paste-file-too-large` toast before any IPC / HTTP traffic.
 * - `src/main/clipboard-ipc.ts` (native host): defence in depth, reject
 *   oversized payloads before writing to disk.
 * - `src/server/modules/clipboard-write-paths.ts` (web server): same defence
 *   in depth for the HTTP path.
 *
 * Pasting a multi-GB ISO into a shell prompt is almost never the intent;
 * if a user genuinely needs a large file at the prompt they can `scp`,
 * `rsync`, or drag-and-drop the path through the file manager (which does
 * not buffer the file contents).
 */
export const PASTE_FILE_MAX_BYTES = 10 * 1024 * 1024 // 10 MiB

/**
 * Per-batch transport ceiling for the `/api/clipboard/files` HTTP route.
 * Sized at `PASTE_FILE_MAX_BYTES + 2 MiB` to cover multipart-encoding
 * overhead on a single max-sized file. A batch where every file is under
 * the per-file cap but the sum exceeds this ceiling is rejected with a
 * generic 413 — that's intentional: the per-file check protects the user
 * (specific toast), the batch limit protects the worker (hostile clients
 * streaming arbitrary bytes).
 */
export const MAX_PASTE_BATCH_BYTES = PASTE_FILE_MAX_BYTES + 2 * 1024 * 1024 // 12 MiB

/**
 * How long pasted blob files stay in the current process's temp dir.
 * Electron stores these under `os.tmpdir()`, which is transient and may
 * be cleared by the OS or on reboot. The web server stores them under
 * `serverDataDir()`, which persists across restarts, so the same 24 h cap
 * is more important there: it bounds durable server-side growth while
 * leaving pasted paths usable for a normal working session.
 */
export const CLIPBOARD_TEMP_FILE_MAX_AGE_MS = 24 * 60 * 60 * 1000

/**
 * Filename used when a `File` synthesised from `clipboardData.items` (or
 * otherwise constructed without a `name`) hits the multipart upload path.
 * Multipart requires a filename for `File` parts; the server-side
 * `sanitizeBaseName` then preserves this literal (it contains no
 * Windows-reserved characters). Both the Electron preload and the web
 * HTTP backend must use this constant so the upload shape stays
 * symmetric across repoOperationSchedulers.
 */
export const CLIPBOARD_FALLBACK_FILE_NAME = 'clipboard.bin'

/**
 * Paths typed into a PTY must not contain terminal/input control bytes.
 * Shell quoting protects against shell metacharacters, but bytes such as
 * ESC, CR, LF, Ctrl-C, or DEL are processed by the terminal/line editor
 * before the shell parser can treat them as part of a quoted string.
 */
export function isTerminalPastePathSafe(path: string): boolean {
  return !/[\x00-\x1f\x7f-\x9f]/.test(path)
}

/**
 * Detect `text/uri-list`-shaped clipboard text. Linux file managers
 * (Nautilus, Dolphin, Thunar, …) emit the URI list both as
 * `text/uri-list` and as `text/plain` — the latter is what shows up in
 * `clipboardData.getData('text/plain')` during a paste event. Excel and
 * other apps that emit tabular data also populate `text/plain`, but
 * with TSV (tabs and newlines, no `file://` prefix). This predicate
 * lets the paste router tell the two apart: a URI-list text rendering
 * is redundant with the `Files` collection on the same paste event, so
 * we should ignore it and prefer the filesystem files; tabular text is
 * the user's actual data and should reach xterm.js's native handler.
 *
 * RFC 2483 allows `#`-prefixed comment lines; we ignore them. We
 * require every *significant* line to start with `file://` — a single
 * non-URI line means the text is real data, not a URI list.
 */
export function looksLikeUriList(text: string): boolean {
  const lines = text.split(/\r?\n/)
  let significant = 0
  for (const raw of lines) {
    const line = raw.trim()
    if (line.length === 0) continue
    if (line.startsWith('#')) continue
    if (!line.startsWith('file://')) return false
    significant += 1
  }
  return significant > 0
}

/**
 * Detect text that looks like a list of absolute paths, one per line.
 *
 * Defensive counterpart to `looksLikeUriList`. Most platforms put
 * newline-separated paths in `text/uri-list` (caught by
 * `looksLikeUriList`) or just the first path / empty string in
 * `text/plain`. Windows Explorer's behaviour for multi-file copy is
 * the main uncertainty: it may put newline-separated absolute paths
 * in `text/plain` without a URI scheme. If any platform does, this
 * check catches it and routes to the file branch so the resolver can
 * shell-quote and write the paths properly rather than letting xterm
 * receive raw newline-joined text.
 *
 * Recognised line shapes (one line must match for the line to count
 * as path-like; we require *every* non-empty line to be path-like):
 * - POSIX absolute: `/home/user/foo`
 * - Windows drive letter: `C:\path\foo` (case-insensitive)
 * - Windows UNC: `\\server\share\foo`
 *
 * **Deliberately NOT matched**: URI schemes other than `file://`
 * (`https://…`, `sftp://…`, `mailto:…`, `javascript:…`, etc.). The shell
 * can't resolve them and the resolver doesn't know how to convert
 * them to filesystem paths. A user copying a list of URLs from a
 * webpage wants those URLs as text, not as paths to a file branch.
 * `file://` URIs are caught by `looksLikeUriList` before reaching
 * this predicate.
 *
 * Single-line input (including single-line with a trailing
 * newline like `"C:\path\file\n"`) returns false — that case is
 * handled by `shouldPreferFilesOverText`, which calls
 * `isAbsolutePathLike` directly for the single-line + files
 * decision. Callers that need the trailing-newline tolerance
 * should route single-line text through `isAbsolutePathLike`,
 * not this predicate.
 */
export function looksLikeAbsolutePathList(text: string): boolean {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  if (lines.length < 2) return false
  return lines.every(isAbsolutePathLike)
}

/**
 * Check whether a single line looks like an absolute filesystem path.
 *
 * Used by `shouldPreferFilesOverText` for two cases:
 * 1. **Single-line + files**: Windows / POSIX single-file copy puts
 *    just the path in `text/plain`. We need to distinguish that from
 *    arbitrary text (single-cell Excel values like `"42"`, prose,
 *    code snippets) which should reach xterm.js natively.
 * 2. **Multi-line + files** (via `looksLikeAbsolutePathList`): same
 *    shape check applied per line, all lines must be path-like.
 *
 * Recognised shapes:
 * - POSIX absolute: `/home/user/foo`
 * - Windows drive letter: `C:\path\foo` (case-insensitive)
 * - Windows UNC: `\\server\share\foo`
 *
 * Non-file URI schemes are deliberately excluded (see
 * `looksLikeAbsolutePathList` docstring for the rationale).
 */
export function isAbsolutePathLike(line: string): boolean {
  if (line.startsWith('/')) return true
  if (line.startsWith('\\\\')) return true
  if (/^[A-Za-z]:[\\\/]/.test(line)) return true
  return false
}
