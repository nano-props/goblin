import { createHash } from 'node:crypto'
import { parse } from 'smol-toml'

export const WORKTREE_BOOTSTRAP_CONFIG_FILE = 'goblin.toml'

export interface WorktreeBootstrapConfig {
  copy: string[]
  symlink: string[]
  hardlink: string[]
  exclude: string[]
  setup?: string
}

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

  return {
    kind: 'ready',
    config: {
      copy: copy.value,
      symlink: symlink.value,
      hardlink: hardlink.value,
      exclude: exclude.value,
      setup: setup.value,
    },
  }
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
