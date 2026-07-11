import { describe, expect, test } from 'vitest'
import path from 'node:path'
import {
  physicalWorktreeIdentityKey,
  type PhysicalWorktreeIdentity,
} from '#/server/worktree-removal/physical-worktree-identity.ts'
import {
  parseRemotePhysicalWorktreeEndpointMarker,
  parseRemotePhysicalWorktreeIdentity,
} from '#/server/worktree-removal/physical-worktree-identity-resolver.ts'

describe('physical worktree identity', () => {
  test('resolved local entries reached through different repo roots share a canonical path key', () => {
    const worktreePath = path.resolve('/worktrees/feature')
    const left: PhysicalWorktreeIdentity = {
      kind: 'local',
      executionNamespaceId: 'local',
      endpoint: worktreePath,
    }
    const right: PhysicalWorktreeIdentity = { ...left }

    expect(left).toEqual({ kind: 'local', executionNamespaceId: 'local', endpoint: worktreePath })
    expect(physicalWorktreeIdentityKey(left)).toBe(physicalWorktreeIdentityKey(right))
  })

  test('resolved remote aliases merge when namespace and canonical path match', () => {
    const left: PhysicalWorktreeIdentity = {
      kind: 'remote',
      executionNamespaceId: '0123456789abcdef0123456789abcdef',
      endpoint: '/srv/worktrees/feature',
    }
    const right: PhysicalWorktreeIdentity = { ...left }

    expect(physicalWorktreeIdentityKey(left)).toBe(physicalWorktreeIdentityKey(right))
  })

  test('remote protocol parses the non-sensitive namespace and canonical path', () => {
    const output = remoteOutput('machine-a')
    expect(parseRemotePhysicalWorktreeIdentity(output)).toEqual({
      kind: 'remote',
      executionNamespaceId: expect.stringMatching(/^[a-f0-9]{32}$/u),
      endpoint: '/srv/worktrees/feature',
    })
    expect(parseRemotePhysicalWorktreeEndpointMarker(output)).toEqual({ deviceId: '10', inode: '20' })
  })

  test('different machine facts cannot collide even if a runtime token is repeated', () => {
    const left = parseRemotePhysicalWorktreeIdentity(remoteOutput('machine-a'))
    const right = parseRemotePhysicalWorktreeIdentity(remoteOutput('machine-b'))

    expect(physicalWorktreeIdentityKey(left)).not.toBe(physicalWorktreeIdentityKey(right))
  })

  test('remote protocol rejects malformed or ambiguous output', () => {
    expect(() => parseRemotePhysicalWorktreeIdentity('short\0machine-a\0mnt-a\0/srv/worktrees/feature\0')).toThrow(
      'error.invalid-worktree-identity',
    )
    expect(() =>
      parseRemotePhysicalWorktreeIdentity(
        '0123456789abcdef0123456789abcdef\0machine-a\0mnt-a\0/srv/worktrees/feature\0extra\0',
      ),
    ).toThrow('error.invalid-worktree-identity')
  })
})

function remoteOutput(machineFact: string): string {
  const deviceId = '10'
  const inode = '20'
  return `0123456789abcdef0123456789abcdef\0${machineFact}\0mnt-a\0/srv/worktrees/feature\0${deviceId}\0${inode}\0`
}
