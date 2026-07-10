import path from 'node:path'
import {
  isRemoteRepoId,
  normalizeRemoteRepoRef,
  parseRemoteRepoId,
} from '#/shared/remote-repo.ts'

export type PhysicalWorktreeIdentity =
  | { kind: 'local'; endpoint: string }
  | { kind: 'remote'; sshAlias: string; endpoint: string }

export interface PhysicalWorktreeIdentityInput {
  repoRoot: string
  worktreePath: string
}

/**
 * Identifies the physical worktree endpoint independently of the repository
 * entry used to reach it. Local linked-worktree repo roots intentionally do
 * not participate in the identity. Remote endpoints retain the SSH alias,
 * because aliases are distinct execution/security boundaries.
 */
export function physicalWorktreeIdentity(input: PhysicalWorktreeIdentityInput): PhysicalWorktreeIdentity {
  if (!isRemoteRepoId(input.repoRoot)) {
    return { kind: 'local', endpoint: path.resolve(input.worktreePath) }
  }
  const repo = parseRemoteRepoId(input.repoRoot)
  const worktree = repo ? normalizeRemoteRepoRef({ alias: repo.alias, remotePath: input.worktreePath }) : null
  if (!repo || !worktree) throw new Error('error.invalid-worktree-identity')
  return { kind: 'remote', sshAlias: repo.alias, endpoint: worktree.remotePath }
}

export function physicalWorktreeIdentityFromRuntimeScope(
  scope: string,
  worktreePath: string,
): PhysicalWorktreeIdentity {
  const separator = scope.lastIndexOf('\0')
  const repoRoot = separator > 0 ? scope.slice(0, separator) : scope
  return physicalWorktreeIdentity({ repoRoot, worktreePath })
}

export function physicalWorktreeIdentityKey(identity: PhysicalWorktreeIdentity): string {
  return identity.kind === 'local'
    ? `local\0${identity.endpoint}`
    : `remote\0${identity.sshAlias}\0${identity.endpoint}`
}
