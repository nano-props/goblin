import { describe, expect, test } from 'vitest'
import { normalizeRemoteRepoId } from '#/shared/remote-repo.ts'
import {
  physicalWorktreeIdentity,
  physicalWorktreeIdentityKey,
} from '#/server/worktree-removal/physical-worktree-identity.ts'

describe('physical worktree identity', () => {
  test('collapses primary and linked local repository entries onto the worktree endpoint', () => {
    const primary = physicalWorktreeIdentity({ repoRoot: '/repo', worktreePath: '/repo-linked' })
    const linked = physicalWorktreeIdentity({ repoRoot: '/repo-linked', worktreePath: '/repo-linked' })

    expect(physicalWorktreeIdentityKey(primary)).toBe(physicalWorktreeIdentityKey(linked))
  })

  test('collapses remote repository entries for one SSH alias and endpoint', () => {
    const primaryRepo = normalizeRemoteRepoId({ alias: 'build-host', remotePath: '/srv/repo' })
    const linkedRepo = normalizeRemoteRepoId({ alias: 'build-host', remotePath: '/srv/repo-linked' })

    expect(
      physicalWorktreeIdentityKey(
        physicalWorktreeIdentity({ repoRoot: primaryRepo, worktreePath: '/srv/repo-linked' }),
      ),
    ).toBe(
      physicalWorktreeIdentityKey(
        physicalWorktreeIdentity({ repoRoot: linkedRepo, worktreePath: '/srv/repo-linked' }),
      ),
    )
  })

  test('keeps different SSH aliases and different endpoints independent', () => {
    const hostA = normalizeRemoteRepoId({ alias: 'host-a', remotePath: '/srv/repo' })
    const hostB = normalizeRemoteRepoId({ alias: 'host-b', remotePath: '/srv/repo' })
    const key = (repoRoot: string, worktreePath: string) =>
      physicalWorktreeIdentityKey(physicalWorktreeIdentity({ repoRoot, worktreePath }))

    expect(key(hostA, '/srv/repo-linked')).not.toBe(key(hostB, '/srv/repo-linked'))
    expect(key(hostA, '/srv/repo-linked')).not.toBe(key(hostA, '/srv/repo-other'))
  })
})
