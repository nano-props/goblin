import type { ReposStore } from '#/web/stores/repos/types.ts'
import type { TerminalDescriptor, TerminalSessionBase } from '#/web/components/terminal/types.ts'

export function worktreeTerminalKey(repoRoot: string, worktreePath: string): string {
  return `${repoRoot}\0${worktreePath}`
}

export function terminalSessionKey(repoRoot: string, worktreePath: string, terminalId: string): string {
  return `${worktreeTerminalKey(repoRoot, worktreePath)}\0${terminalId}`
}

export function parseTerminalSessionKey(key: string): { repoRoot: string; worktreePath: string; terminalId: string } | null {
  const parts = key.split('\0')
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null
  return { repoRoot: parts[0], worktreePath: parts[1], terminalId: parts[2] }
}

export function terminalDescriptor(base: TerminalSessionBase, terminalId: string, index: number): TerminalDescriptor {
  const terminalWorktreeKey = worktreeTerminalKey(base.repoRoot, base.worktreePath)
  return {
    ...base,
    worktreeTerminalKey: terminalWorktreeKey,
    terminalId,
    index,
    key: terminalSessionKey(base.repoRoot, base.worktreePath, terminalId),
  }
}

export function isTerminalDescriptorLive(repos: ReposStore['repos'], descriptor: TerminalDescriptor): boolean {
  const repo = repos[descriptor.repoRoot]
  return !!repo?.data.branches.some((branch) => branch.worktree?.path === descriptor.worktreePath)
}

export function compactTerminalTitle(title: string): string {
  const normalized = normalizeTitle(title)
  if (!normalized) return ''
  const labelStripped = stripLeadingLabel(normalized)
  if (labelStripped !== normalized) return compactTerminalTitle(labelStripped)
  const split = splitTerminalTitle(normalized)
  if (split) {
    const context = compactContext(split.leading)
    const main = compactMain(split.trailing)
    return joinCompactTitle(context, main)
  }
  const url = compactUrl(normalized)
  if (url) return truncateTitle(url)
  if (/\s/.test(normalized) && !startsWithPathPrefix(normalized)) return compactCommand(normalized)
  const hostPath = compactHostPath(normalized)
  if (hostPath) return truncateTitle(hostPath)
  const pathLike = compactPath(normalized)
  if (pathLike) return truncateTitle(pathLike)
  return compactCommand(normalized)
}

function compactHostPath(value: string): string | null {
  const match = /^((?:[^@\s:]+@)?[A-Za-z0-9._-]+):(.+)$/.exec(value)
  if (!match) return null
  const host = match[1]?.trim()
  const target = match[2]?.trim()
  if (!host || !target || isUrlScheme(host) || !looksLikePath(target)) return null
  return `${host} · ${basename(target)}`
}

function compactPath(value: string): string | null {
  if (!looksLikePath(value)) return null
  return basename(value)
}

function compactUrl(value: string): string | null {
  if (!looksLikeUrl(value)) return null
  try {
    const parsed = new URL(value)
    return basename(parsed.pathname) || parsed.hostname || value
  } catch {
    return null
  }
}

function compactCommand(value: string): string {
  const words = value.split(/\s+/).filter((word) => word.length > 0)
  if (words.length === 0) return ''
  if (words.length === 1) return truncateTitle(words[0] || value)
  const normalized = words.join(' ')
  if (words.length === 2) {
    const [first, second] = words
    if (second && looksLikePath(second)) return truncateTitle(`${first} ${basename(second)}`)
    return truncateTitle(normalized)
  }
  let compact = ''
  for (const word of words) {
    const next = compact.length === 0 ? word : `${compact} ${word}`
    if (next.length > MAX_COMPACT_TERMINAL_TITLE_LENGTH) break
    compact = next
    if (compact.split(/\s+/).length >= 3) break
  }
  return truncateTitle(compact || normalized)
}

function basename(value: string): string {
  return value.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) || value
}

function normalizeTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function stripLeadingLabel(value: string): string {
  const match = /^(devin):\s+(.+)$/i.exec(value)
  if (!match) return value
  return match[2]?.trim() || value
}

const MAX_COMPACT_TERMINAL_TITLE_LENGTH = 32
const TERMINAL_TITLE_SEPARATORS = [' — ', ' – ', ' | ', ' - ']

function splitTerminalTitle(value: string): { leading: string; trailing: string } | null {
  let bestIndex = -1
  let bestSeparator = ''
  for (const separator of TERMINAL_TITLE_SEPARATORS) {
    const index = value.lastIndexOf(separator)
    if (index > bestIndex) {
      bestIndex = index
      bestSeparator = separator
    }
  }
  if (bestIndex <= 0 || !bestSeparator) return null
  const leading = value.slice(0, bestIndex).trim()
  const trailing = value.slice(bestIndex + bestSeparator.length).trim()
  return leading && trailing ? { leading, trailing } : null
}

function compactContext(value: string): string {
  const hostPath = compactHostPath(value)
  if (hostPath) return truncateTitle(hostPath)
  const pathLike = compactPath(value)
  if (pathLike) return truncateTitle(pathLike)
  return truncateTitle(value)
}

function compactMain(value: string): string {
  const hostPath = compactHostPath(value)
  if (hostPath) return truncateTitle(hostPath)
  const pathLike = compactPath(value)
  if (pathLike) return truncateTitle(pathLike)
  return compactCommand(value)
}

function joinCompactTitle(context: string, main: string): string {
  if (!context) return truncateTitle(main)
  if (!main) return truncateTitle(context)
  const combined = `${context} · ${main}`
  if (combined.length <= MAX_COMPACT_TERMINAL_TITLE_LENGTH) return combined
  if (main.length >= context.length) {
    const budget = Math.max(8, MAX_COMPACT_TERMINAL_TITLE_LENGTH - context.length - 3)
    return `${context} · ${truncateTitle(main, budget)}`
  }
  const budget = Math.max(8, MAX_COMPACT_TERMINAL_TITLE_LENGTH - main.length - 3)
  return `${truncateTitle(context, budget)} · ${main}`
}

function truncateTitle(value: string, maxLength = MAX_COMPACT_TERMINAL_TITLE_LENGTH): string {
  if (value.length <= maxLength) return value
  if (maxLength <= 1) return '…'
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

function looksLikePath(value: string): boolean {
  if (!value) return false
  if (startsWithPathPrefix(value)) return true
  if (/^[A-Za-z]:[\\/]/.test(value)) return true
  return /[\\/]/.test(value) && !looksLikeUrl(value)
}

function looksLikeUrl(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)
}

function isUrlScheme(value: string): boolean {
  return ['file', 'ftp', 'http', 'https', 'mailto', 'ssh', 'ws', 'wss'].includes(value.toLowerCase())
}

function startsWithPathPrefix(value: string): boolean {
  return /^(~[\\/]|\/|\.{1,2}[\\/])/.test(value)
}
