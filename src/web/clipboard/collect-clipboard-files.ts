/** Collect real files from either browser DataTransfer representation. */
export function collectClipboardFiles(data: DataTransfer | null): File[] {
  if (!data) return []
  const files: File[] = []
  const filesProp = data.files
  if (filesProp && filesProp.length > 0) {
    for (let i = 0; i < filesProp.length; i += 1) {
      const file = filesProp.item(i)
      if (isNonPlaceholderClipboardFile(file)) files.push(file)
    }
    if (files.length > 0) return files
  }
  const items = data.items
  if (items && items.length > 0) {
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i]
      if (item.kind !== 'file') continue
      const file = item.getAsFile()
      if (isNonPlaceholderClipboardFile(file)) files.push(file)
    }
  }
  return files
}

export function isNonPlaceholderClipboardFile(file: File | null): file is File {
  return file !== null && (file.size > 0 || file.name.length > 0)
}
