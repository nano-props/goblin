import { PASTE_FILE_MAX_BYTES } from '#/shared/clipboard-paste.ts'
import { resolvePastedFiles, type PasteResolution } from '#/web/clipboard/resolver.ts'

/**
 * Pure helpers that decide what a `paste` or `drop` event should do,
 * given just the relevant clipboard / dataTransfer fields. The
 * `TerminalSlot` handlers wrap these with React state + toast plumbing,
 * but the logic itself is testable without a DOM event constructor
 * (jsdom's `ClipboardEvent` / `DataTransfer` are partial stubs).
 */

export type PasteOutcome =
  | { kind: 'no-op' }
  | { kind: 'text'; text: string }
  | { kind: 'too-large' }
  | { kind: 'files'; resolution: PasteResolution }

export interface PasteInputs {
  files: File[]
  text: string
}

export interface DropInputs {
  files: File[]
}

/**
 * Decide what a paste should do without firing it. Files win over text
 * — on Linux a file copy carries both `text/uri-list` and a
 * `text/plain` rendering of the same URI list; if we let text win the
 * user sees a literal `file:///…` string in the PTY.
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
  if (inputs.text.length > 0) return { kind: 'text', text: inputs.text }
  return { kind: 'no-op' }
}

export type DropOutcome = { kind: 'no-op' } | { kind: 'too-large' } | { kind: 'files'; resolution: PasteResolution }

export async function processDrop(inputs: DropInputs): Promise<DropOutcome> {
  if (inputs.files.length === 0) return { kind: 'no-op' }
  if (inputs.files.some((f) => f.size > PASTE_FILE_MAX_BYTES)) return { kind: 'too-large' }
  const resolution = await resolvePastedFiles(inputs.files)
  return { kind: 'files', resolution }
}
