import { PASTE_FILE_MAX_BYTES } from '#/shared/clipboard-paste.ts'
import { resolvePastedFiles, type PasteResolution } from '#/web/clipboard/resolver.ts'

/**
 * Pure helpers that decide what a `paste` or `drop` event should do,
 * given just the relevant clipboard / dataTransfer fields. The
 * `TerminalSlot` handlers wrap these with React state + toast plumbing,
 * but the logic itself is testable without a DOM event constructor
 * (jsdom's `ClipboardEvent` / `DataTransfer` are partial stubs).
 *
 * Text payloads (the `text/plain` rendering of a `ClipboardEvent`) are
 * intentionally not part of this surface. The terminal slot falls
 * through to xterm's own text path when no files are present — we
 * never need to decide what to do with text here, only with files.
 */

export type PasteOutcome = { kind: 'no-op' } | { kind: 'too-large' } | { kind: 'files'; resolution: PasteResolution }

export interface PasteInputs {
  files: File[]
}

export interface DropInputs {
  files: File[]
}

/**
 * Decide what a paste should do without firing it. Files win over
 * text — on Linux a file copy carries both `text/uri-list` and a
 * `text/plain` rendering of the same URI list, but we only ever
 * reach this function with files already extracted; the no-files
 * branch is the caller's xterm fallback.
 *
 * The function is async because the files branch awaits the resolver.
 * Caller wires `event.preventDefault()` *synchronously* based on the
 * presence of files (so xterm doesn't see the event); the resolution
 * itself happens asynchronously.
 */
export async function processPaste(inputs: PasteInputs): Promise<PasteOutcome> {
  if (inputs.files.length > 0) {
    if (inputs.files.some((f) => f.size > PASTE_FILE_MAX_BYTES)) return { kind: 'too-large' }
    const resolution = await resolvePastedFiles(inputs.files)
    return { kind: 'files', resolution }
  }
  return { kind: 'no-op' }
}

export type DropOutcome = { kind: 'no-op' } | { kind: 'too-large' } | { kind: 'files'; resolution: PasteResolution }

export async function processDrop(inputs: DropInputs): Promise<DropOutcome> {
  if (inputs.files.length === 0) return { kind: 'no-op' }
  if (inputs.files.some((f) => f.size > PASTE_FILE_MAX_BYTES)) return { kind: 'too-large' }
  const resolution = await resolvePastedFiles(inputs.files)
  return { kind: 'files', resolution }
}
