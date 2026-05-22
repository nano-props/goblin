function ellipsizeMiddleText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  if (maxChars <= 0) return ''
  if (maxChars === 1) return '…'
  const keep = maxChars - 1
  const left = Math.ceil(keep / 2)
  const right = Math.floor(keep / 2)
  const tail = right === 0 ? '' : text.slice(-right)
  return `${text.slice(0, left)}…${tail}`
}

export function ellipsizeMiddlePath(path: string, maxChars: number): string {
  const budget = Number.isFinite(maxChars) ? Math.max(0, Math.floor(maxChars)) : 0
  if (path.length <= budget) return path
  if (budget <= 0) return ''

  const parts = path.split('/')
  if (parts.length < 2) return ellipsizeMiddleText(path, budget)

  const head = parts[0]
  const separator = '/…/'
  for (let suffixCount = parts.length - 1; suffixCount >= 1; suffixCount -= 1) {
    const suffix = parts.slice(-suffixCount).join('/')
    const candidate = `${head}${separator}${suffix}`
    if (candidate.length <= budget) return candidate
  }

  const file = parts.at(-1) ?? path
  const fileCandidate = `…/${file}`
  if (fileCandidate.length <= budget) return fileCandidate

  return ellipsizeMiddleText(fileCandidate, budget)
}
