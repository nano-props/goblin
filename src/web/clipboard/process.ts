import {
  PASTE_FILE_MAX_BYTES,
  isAbsolutePathLike,
  looksLikeAbsolutePathList,
  looksLikeUriList,
} from '#/shared/clipboard-paste.ts'
import { resolvePastedFiles, type PasteResolution } from '#/web/clipboard/resolver.ts'

/**
 * Pure helpers that decide what a `paste` event should do, given
 * just the relevant clipboard fields. The `TerminalSessionView` handler is
 * a thin wrapper that reads `clipboardData` synchronously and routes
 * to one of three branches:
 *
 * - **text branch**: do nothing — let xterm.js's native paste handler
 *   pick up the text and write it to PTY (with bracketed-paste wrap
 *   when the shell has enabled mode 2004).
 * - **files branch**: stop the event from reaching xterm.js, resolve
 *   paths via the resolver (`resolvePastedFiles`), and write the
 *   shell-escaped path list to PTY.
 * - **too-large branch**: stop the event, toast
 *   `terminal.paste-file-too-large`, return.
 *
 * `previewPaste` is **synchronous** and side-effect free. The
 * `TerminalSessionView` handler calls it in the capture-phase listener so it can call
 * `event.preventDefault()` and `event.stopPropagation()` *before* the
 * event reaches xterm.js's descendant textarea listener — awaiting
 * a Promise first would let xterm.js fire and write the text to PTY
 * before we could stop it.
 *
 * The async resolver lives in `resolver.ts`; this module only owns
 * the routing decision. `processDrop` is the file-only companion
 * for drag-and-drop (no text channel there).
 */

export interface PasteInputs {
  /** `clipboardData.getData('text/plain')` — empty string when absent. */
  text: string
  files: File[]
}

export interface DropInputs {
  files: File[]
}

/**
 * Synchronous preview of what a paste will do. Lets the caller decide
 * whether to call `event.preventDefault()` / `event.stopPropagation()`
 * before any async work runs.
 */
export type PastePreview =
  | { kind: 'no-op' }
  | { kind: 'too-large' }
  | { kind: 'text'; text: string }
  | { kind: 'files' }

/**
 * Decide which channel wins when both `text/plain` and `Files` are
 * present on the same paste event.
 *
 * Signals, in priority order:
 * - **Tab character** (`\t`): strongest signal of tabular data
 *   (Excel / Numbers / Sheets TSV). Single-row and multi-row copies
 *   always contain tabs, so this branch reliably keeps tabular data
 *   on xterm's native text path.
 * - **URI list** (`file://…` per line): Linux file manager copies
 *   render `text/uri-list` as `text/plain` too; the text is a
 *   redundant rendering of the same URIs already in `Files`.
 * - **Multi-line absolute paths** (POSIX `/…`, Windows `C:\…`,
 *   UNC `\\…`): defensive coverage for the hypothetical platform
 *   that puts newline-separated absolute paths in `text/plain`
 *   without a URI scheme (Windows Explorer's multi-file copy
 *   behaviour is the main uncertainty). Non-path multi-line text
 *   (OCR output, prose) → text wins.
 * - **Single-line absolute path**: Windows single-file copy puts
 *   just the path in `text/plain` (e.g. `C:\Users\foo\bar.png`).
 *   The resolver's path-attempt tier produces a shell-quoted path
 *   the user almost certainly prefers over the bare text.
 * - **Single-line plain text** (no tab, no URI, no path shape):
 *   single-cell Excel values like `"42"`, prose, code snippets.
 *   These reach xterm.js as text rather than being silently routed
 *   to the file branch.
 *
 * Exported for unit testing.
 */
export function shouldPreferFilesOverText(text: string, hasFiles: boolean): boolean {
  if (!hasFiles) return false
  if (text.length === 0) return true
  if (looksLikeUriList(text)) return true
  // Tab is the strongest tabular signal — covers single-row and
  // multi-row Excel/Numbers/Sheets copies.
  if (text.includes('\t')) return false
  if (/[\r\n]/.test(text)) {
    // Multi-line without tabs: defensive check for newline-
    // separated absolute paths from platforms that don't use
    // URI lists. A single non-empty line plus a trailing newline
    // should still behave like the single-line path case.
    const significantLines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    if (significantLines.length === 1) return isAbsolutePathLike(significantLines[0])
    // Anything not path-like is real data → text wins.
    return looksLikeAbsolutePathList(text)
  }
  // Single-line non-URI non-tab text + files: only prefer files
  // if the text actually looks like an absolute path (Windows /
  // POSIX single-file copy). Otherwise it's real data — single-cell
  // Excel values, prose, code snippets — and should reach xterm.
  return isAbsolutePathLike(text.trim())
}

export function previewPaste(inputs: PasteInputs): PastePreview {
  const hasFiles = inputs.files.length > 0
  if (!hasFiles && inputs.text.length === 0) return { kind: 'no-op' }
  // After the line above, `inputs.text.length > 0` or `hasFiles` (or both).
  if (shouldPreferFilesOverText(inputs.text, hasFiles)) {
    if (inputs.files.some((f) => f.size > PASTE_FILE_MAX_BYTES)) return { kind: 'too-large' }
    return { kind: 'files' }
  }
  return { kind: 'text', text: inputs.text }
}

export type DropOutcome = { kind: 'no-op' } | { kind: 'too-large' } | { kind: 'files'; resolution: PasteResolution }

export async function processDrop(inputs: DropInputs): Promise<DropOutcome> {
  if (inputs.files.length === 0) return { kind: 'no-op' }
  if (inputs.files.some((f) => f.size > PASTE_FILE_MAX_BYTES)) return { kind: 'too-large' }
  const resolution = await resolvePastedFiles(inputs.files)
  return { kind: 'files', resolution }
}
