/**
 * Collect file entries from a `ClipboardEvent.clipboardData` or
 * `DragEvent.dataTransfer`, mirroring the existing drop semantics.
 *
 * Prefers the modern `data.files` collection (browser already filtered
 * to `kind === 'file'` items). Falls back to `data.items` for runtimes
 * that surface clipboard blobs only there — even though `DataTransfer`
 * is a partial stub in jsdom, real browsers populate one or the other,
 * so trying both shapes is the right contract.
 *
 * Zero-byte entries with no filename (some platforms emit them as
 * placeholders for "there's clipboard data but no real file") are
 * filtered out. Named zero-byte files are legitimate filesystem entries
 * and must still be allowed through so the path-attempt tier can resolve
 * them.
 */
export function collectClipboardFiles(data: DataTransfer | null): File[] {
  if (!data) return []
  const files: File[] = []
  const filesProp = data.files
  if (filesProp && filesProp.length > 0) {
    for (let i = 0; i < filesProp.length; i += 1) {
      const file = filesProp.item(i)
      if (isMeaningfulClipboardFile(file)) files.push(file)
    }
    if (files.length > 0) return files
  }
  const items = data.items
  if (items && items.length > 0) {
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i]
      if (item.kind !== 'file') continue
      const file = item.getAsFile()
      if (isMeaningfulClipboardFile(file)) files.push(file)
    }
  }
  return files
}

export function isMeaningfulClipboardFile(file: File | null): file is File {
  return !!file && (file.size > 0 || file.name.length > 0)
}
