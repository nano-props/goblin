/**
 * Per-file ceiling for clipboard paste / drop into the terminal slot.
 *
 * Read by:
 * - `TerminalSlot` paste / drop handlers (renderer): early bail-out with
 *   `terminal.paste-file-too-large` toast before any IPC / HTTP traffic.
 * - `src/main/clipboard-bridge.ts` (Electron main): defence in depth, reject
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
 * Startup cleanup still removes previous-process dirs immediately; this
 * age cap keeps a long-running desktop app or LAN server from growing its
 * current temp dir forever while leaving pasted paths usable for a normal
 * working session.
 */
export const CLIPBOARD_TEMP_FILE_MAX_AGE_MS = 24 * 60 * 60 * 1000

/**
 * Filename used when a `File` synthesised from `clipboardData.items` (or
 * otherwise constructed without a `name`) hits the multipart upload path.
 * Multipart requires a filename for `File` parts; the server-side
 * `sanitizeBaseName` then preserves this literal (it contains no
 * Windows-reserved characters). Both the Electron preload and the web
 * HTTP backend must use this constant so the upload shape stays
 * symmetric across runtimes.
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
