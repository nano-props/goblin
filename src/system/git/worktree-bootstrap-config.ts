import { createHash } from 'node:crypto'
import path from 'node:path'
import { parse } from 'smol-toml'

export const WORKTREE_BOOTSTRAP_CONFIG_FILE = 'goblin.toml'

export interface WorktreeBootstrapConfig {
  copy: string[]
  symlink: string[]
  hardlink: string[]
  exclude: string[]
  setup?: string
}

const WINDOWS_ROOTED_PATH_RE = /^(?:[A-Za-z]:|[\\/])/
const UNSUPPORTED_GLOB_SYNTAX_RE = /[{}]|[!+@?*]\(/

export function worktreeBootstrapConfigHash(raw: string): string {
  return `sha256:${createHash('sha256').update(raw, 'utf8').digest('hex')}`
}

export function parseBootstrapConfig(
  raw: string,
): { kind: 'none' } | { kind: 'ready'; config: WorktreeBootstrapConfig } | { kind: 'error'; message: string } {
  let parsed: unknown
  try {
    parsed = parse(raw)
  } catch (err) {
    return { kind: 'error', message: `invalid ${WORKTREE_BOOTSTRAP_CONFIG_FILE}: ${errorMessage(err)}` }
  }

  const root = asRecord(parsed)
  if (!root) return { kind: 'error', message: `${WORKTREE_BOOTSTRAP_CONFIG_FILE} must contain a table` }
  if (root.worktree === undefined) return { kind: 'none' }
  const worktree = asRecord(root.worktree)
  if (!worktree) return { kind: 'error', message: '[worktree] must be a table' }

  const copy = readStringList(worktree, 'copy')
  if (!copy.ok) return { kind: 'error', message: copy.message }
  const symlink = readStringList(worktree, 'symlink')
  if (!symlink.ok) return { kind: 'error', message: symlink.message }
  const hardlink = readStringList(worktree, 'hardlink')
  if (!hardlink.ok) return { kind: 'error', message: hardlink.message }
  const exclude = readStringList(worktree, 'exclude')
  if (!exclude.ok) return { kind: 'error', message: exclude.message }
  const setup = readSetupCommand(worktree)
  if (!setup.ok) return { kind: 'error', message: setup.message }

  const config = canonicalWorktreeBootstrapConfig({
    copy: copy.value,
    symlink: symlink.value,
    hardlink: hardlink.value,
    exclude: exclude.value,
    setup: setup.value,
  })
  return config.ok ? { kind: 'ready', config: config.value } : { kind: 'error', message: config.message }
}

/**
 * Canonical path/glob contract shared by local and SSH bootstrap execution.
 *
 * The supported glob grammar is deliberately limited to `*`, `**`, `?`, and
 * bracket expressions. Bash and tinyglobby do not agree on brace expansion or
 * extglobs, so those forms fail while parsing instead of diverging after a
 * worktree has already been created.
 */
function canonicalWorktreeBootstrapConfig(
  config: WorktreeBootstrapConfig,
): { ok: true; value: WorktreeBootstrapConfig } | { ok: false; message: string } {
  const copy = canonicalBootstrapPaths(config.copy)
  if (!copy.ok) return copy
  const symlink = canonicalBootstrapPaths(config.symlink)
  if (!symlink.ok) return symlink
  const hardlink = canonicalBootstrapPaths(config.hardlink)
  if (!hardlink.ok) return hardlink
  const exclude = canonicalBootstrapPaths(config.exclude)
  if (!exclude.ok) return exclude
  return {
    ok: true,
    value: {
      copy: copy.value,
      symlink: symlink.value,
      hardlink: hardlink.value,
      exclude: exclude.value,
      setup: config.setup,
    },
  }
}

function canonicalBootstrapPaths(
  entries: readonly string[],
): { ok: true; value: string[] } | { ok: false; message: string } {
  const value: string[] = []
  for (const entry of entries) {
    const canonical = canonicalBootstrapPath(entry)
    if (!canonical.ok) return canonical
    value.push(canonical.value)
  }
  return { ok: true, value }
}

function canonicalBootstrapPath(entry: string): { ok: true; value: string } | { ok: false; message: string } {
  if (entry.length === 0) return { ok: false, message: 'bootstrap path must not be empty' }
  if (/[\0-\x1f\x7f]/.test(entry)) {
    return { ok: false, message: `bootstrap path contains control characters: ${entry}` }
  }
  if (entry.startsWith('!')) return { ok: false, message: `negative glob patterns are not supported: ${entry}` }
  if (path.isAbsolute(entry) || WINDOWS_ROOTED_PATH_RE.test(entry)) {
    return { ok: false, message: `bootstrap path must be relative: ${entry}` }
  }
  if (UNSUPPORTED_GLOB_SYNTAX_RE.test(entry)) {
    return { ok: false, message: `unsupported bootstrap glob syntax: ${entry}` }
  }

  const normalizedSeparators = entry.replace(/\\/g, '/')
  const withoutTrailingSeparators = normalizedSeparators.replace(/\/+$/u, '')
  if (withoutTrailingSeparators === '.') {
    return { ok: false, message: `bootstrap path must not target repo root: ${entry}` }
  }
  const segments = normalizedSeparators.split('/')
  if (segments.includes('.')) return { ok: false, message: `bootstrap path must not contain dot segments: ${entry}` }
  if (segments.includes('..')) return { ok: false, message: `bootstrap path escapes repo root: ${entry}` }
  if (segments.includes('.git')) return { ok: false, message: `bootstrap path must not target .git: ${entry}` }

  const canonical = path.posix.normalize(withoutTrailingSeparators)
  return { ok: true, value: canonical }
}

function readStringList(
  table: Record<string, unknown>,
  key: 'copy' | 'symlink' | 'hardlink' | 'exclude',
): { ok: true; value: string[] } | { ok: false; message: string } {
  const value = table[key]
  if (value === undefined) return { ok: true, value: [] }
  if (!Array.isArray(value)) return { ok: false, message: `[worktree].${key} must be an array of strings` }
  const strings: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') return { ok: false, message: `[worktree].${key} must be an array of strings` }
    strings.push(item)
  }
  return { ok: true, value: strings }
}

function readSetupCommand(
  table: Record<string, unknown>,
): { ok: true; value?: string } | { ok: false; message: string } {
  const value = table.setup
  if (value === undefined) return { ok: true }
  if (typeof value !== 'string') return { ok: false, message: '[worktree].setup must be a string' }
  if (value.includes('\0')) return { ok: false, message: '[worktree].setup must not contain NUL bytes' }
  return value.trim().length > 0 ? { ok: true, value } : { ok: true }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
