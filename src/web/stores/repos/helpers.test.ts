import { describe, expect, test } from 'vitest'
import { normalizeRemoteTarget } from '#/shared/remote-repo.ts'
import { deriveConnectivity, emptyRepo } from '#/web/stores/repos/helpers.ts'

const REMOTE_ID = 'ssh-config://example/srv/repo'

describe('deriveConnectivity', () => {
  test('local repos always read as connected', () => {
    const repo = emptyRepo('/tmp/local-repo', 'local')
    expect(deriveConnectivity(repo)).toBe('connected')
  })

  test('a remote placeholder with no target reads as connecting', () => {
    const repo = emptyRepo(REMOTE_ID, 'remote')
    // insertPlaceholderRepo doesn't set remote.target; availability stays available.
    expect(repo.remote.target).toBeUndefined()
    expect(deriveConnectivity(repo)).toBe('connecting')
  })

  test('a remote repo with a resolved target reads as connected', () => {
    const repo = emptyRepo(REMOTE_ID, 'remote')
    const target = normalizeRemoteTarget({
      alias: 'example',
      host: 'example.com',
      user: 'alice',
      port: 22,
      remotePath: '/srv/repo',
    })
    expect(target).not.toBeNull()
    repo.remote.target = target!
    expect(deriveConnectivity(repo)).toBe('connected')
  })

  test('an unavailable remote repo reads as unreachable regardless of target presence', () => {
    const repo = emptyRepo(REMOTE_ID, 'remote')
    const target = normalizeRemoteTarget({
      alias: 'example',
      host: 'example.com',
      user: 'alice',
      port: 22,
      remotePath: '/srv/repo',
    })
    expect(target).not.toBeNull()
    repo.remote.target = target!
    repo.availability = { phase: 'unavailable', reason: 'path-missing', checkedAt: 0 }
    expect(deriveConnectivity(repo)).toBe('unreachable')

    // Same when the alias dropped out of ssh/config and resolveRemoteRepositoryTarget
    // never produced a target — both branches land on 'unreachable'.
    repo.remote.target = undefined
    expect(deriveConnectivity(repo)).toBe('unreachable')
  })
})