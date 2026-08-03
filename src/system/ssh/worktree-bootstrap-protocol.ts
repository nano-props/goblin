export const REMOTE_WORKTREE_BOOTSTRAP_RECORD_TAGS = {
  copy: 'GOBLIN_BOOTSTRAP_COPY',
  symlink: 'GOBLIN_BOOTSTRAP_SYMLINK',
  hardlink: 'GOBLIN_BOOTSTRAP_HARDLINK',
  missing: 'GOBLIN_BOOTSTRAP_MISSING',
  setup: 'GOBLIN_BOOTSTRAP_SETUP',
} as const

type RemoteWorktreeBootstrapRecordKind = keyof typeof REMOTE_WORKTREE_BOOTSTRAP_RECORD_TAGS

interface RemoteWorktreeBootstrapRecord {
  kind: RemoteWorktreeBootstrapRecordKind
  value: string
}

/** Decode NUL-framed records. POSIX paths and setup commands cannot contain NUL. */
export function decodeRemoteWorktreeBootstrapRecords(output: string): RemoteWorktreeBootstrapRecord[] {
  const fields = output.split('\0')
  const records: RemoteWorktreeBootstrapRecord[] = []
  // Every NUL terminates exactly one field. The final split element is always
  // unterminated (and empty when output ends in NUL), so it cannot participate
  // in a record. A truncated next tag must not erase preceding complete pairs.
  const completeFieldCount = Math.max(0, fields.length - 1)
  for (let index = 0; index + 1 < completeFieldCount; index += 2) {
    const tag = fields[index]
    const value = fields[index + 1]
    const kind = tag === undefined ? null : remoteWorktreeBootstrapRecordKind(tag)
    if (kind && value !== undefined) records.push({ kind, value })
  }
  return records
}

function remoteWorktreeBootstrapRecordKind(tag: string): RemoteWorktreeBootstrapRecordKind | null {
  switch (tag) {
    case REMOTE_WORKTREE_BOOTSTRAP_RECORD_TAGS.copy:
      return 'copy'
    case REMOTE_WORKTREE_BOOTSTRAP_RECORD_TAGS.symlink:
      return 'symlink'
    case REMOTE_WORKTREE_BOOTSTRAP_RECORD_TAGS.hardlink:
      return 'hardlink'
    case REMOTE_WORKTREE_BOOTSTRAP_RECORD_TAGS.missing:
      return 'missing'
    case REMOTE_WORKTREE_BOOTSTRAP_RECORD_TAGS.setup:
      return 'setup'
    default:
      return null
  }
}
