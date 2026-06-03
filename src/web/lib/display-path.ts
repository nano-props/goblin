export type TextWidthMeasurer = (text: string) => number

function normalizeMaxWidth(maxWidth: number): number {
  return Number.isFinite(maxWidth) ? Math.max(0, maxWidth) : 0
}

export function ellipsizeLeftTextByWidth(text: string, maxWidth: number, measureText: TextWidthMeasurer): string {
  const budget = normalizeMaxWidth(maxWidth)
  if (budget <= 0) return ''
  if (measureText(text) <= budget) return text
  if (measureText('…') > budget) return ''

  let lo = 0
  let hi = text.length
  let best = '…'

  while (lo <= hi) {
    const keep = Math.floor((lo + hi) / 2)
    const candidate = keep > 0 ? `…${text.slice(-keep)}` : '…'
    if (measureText(candidate) <= budget) {
      best = candidate
      lo = keep + 1
    } else {
      hi = keep - 1
    }
  }

  return best
}

/** Left-elide git-style POSIX paths (for example paths from git status/diff output).
 *  This intentionally treats `/` as the only segment separator and is not a
 *  general filesystem path formatter. */
export function ellipsizeLeftPathByWidth(path: string, maxWidth: number, measureText: TextWidthMeasurer): string {
  const budget = normalizeMaxWidth(maxWidth)
  if (budget <= 0) return ''
  if (measureText(path) <= budget) return path

  const parts = path.split('/')
  if (parts.length < 2) return ellipsizeLeftTextByWidth(path, budget, measureText)

  for (let suffixCount = parts.length - 1; suffixCount >= 1; suffixCount -= 1) {
    const suffix = parts.slice(-suffixCount).join('/')
    const candidate = `…/${suffix}`
    if (measureText(candidate) <= budget) return candidate
  }

  const file = parts.at(-1) ?? path
  return ellipsizeLeftTextByWidth(`/${file}`, budget, measureText)
}
