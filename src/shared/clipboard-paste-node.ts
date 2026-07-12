import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { CLIPBOARD_SANITIZE_FALLBACK_FILE_NAME } from '#/shared/clipboard-paste.ts'

const WINDOWS_RESERVED_FILE_STEM_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

function avoidWindowsReservedBaseName(base: string): string {
  const dot = base.lastIndexOf('.')
  const stem = (dot > 0 ? base.slice(0, dot) : base).replace(/\.+$/g, '')
  return WINDOWS_RESERVED_FILE_STEM_RE.test(stem) ? `_${base}` : base
}

/**
 * Reduce an arbitrary user-supplied name (which may contain path
 * separators or a leading directory) to a safe filesystem basename.
 */
export function sanitizeClipboardFileBaseName(name: string): string {
  const base = path
    .basename(name)
    .replace(/[<>:"/\\|?*\x00-\x1f\x7f-\x9f]/g, '_')
    .trim()
  return base.length > 0 ? avoidWindowsReservedBaseName(base) : CLIPBOARD_SANITIZE_FALLBACK_FILE_NAME
}

export function createClipboardTimestampedFileName(): (index: number, baseName: string) => string {
  let counter = 0
  return (index, baseName) => {
    counter += 1
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    return `${timestamp}-${index}-${counter}-${sanitizeClipboardFileBaseName(baseName)}`
  }
}

/** Best-effort wrapper for prune sweeps where a missing dir is expected. */
export async function listDirEntries(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch {
    return []
  }
}
