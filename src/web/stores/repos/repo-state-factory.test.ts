import { describe, expect, test } from 'vitest'
import { normalizeRemoteTarget } from '#/shared/remote-repo.ts'
import { emptyRepo } from '#/web/stores/repos/repo-state-factory.ts'
import { deriveConnectivity } from '#/web/stores/repos/repo-guards.ts'

const REMOTE_ID = 'ssh-config://example/srv/repo'

function remoteTargetFixture() {
  const target = normalizeRemoteTarget({
    alias: 'example',
    host: 'example.com',
    user: 'alice',
    port: 22,
    remotePath: '/srv/repo',
  })
  expect(target).not.toBeNull()
  return target!
}

describe('deriveConnectivity', () => {
  test('local repos always read as connected', () => {
    const repo = emptyRepo('/tmp/local-repo', 'local', 'repo-runtime-test')
    expect(deriveConnectivity(repo)).toBe('connected')
  })

  test('a remote repo with lifecycle=connecting reads as connecting', () => {
    const repo = emptyRepo(REMOTE_ID, 'remote', 'repo-runtime-test')
    repo.remote.lifecycle = { kind: 'connecting' }
    expect(deriveConnectivity(repo)).toBe('connecting')
  })

  test('a remote repo with lifecycle=ready reads as connected', () => {
    const repo = emptyRepo(REMOTE_ID, 'remote', 'repo-runtime-test')
    const target = remoteTargetFixture()
    repo.remote.lifecycle = { kind: 'ready', target }
    expect(deriveConnectivity(repo)).toBe('connected')
  })

  test('a remote repo with lifecycle=failed reads as unreachable', () => {
    const repo = emptyRepo(REMOTE_ID, 'remote', 'repo-runtime-test')
    repo.remote.lifecycle = { kind: 'failed', reason: 'unreachable' }
    expect(deriveConnectivity(repo)).toBe('unreachable')
  })

  test('a remote repo with lifecycle=failed but a retained target still reads as unreachable', () => {
    const repo = emptyRepo(REMOTE_ID, 'remote', 'repo-runtime-test')
    const target = remoteTargetFixture()
    repo.remote.lifecycle = { kind: 'failed', reason: 'timeout', target }
    expect(deriveConnectivity(repo)).toBe('unreachable')
  })

  test('a remote repo with no lifecycle reads as connecting', () => {
    // A remote repo without a lifecycle is treated as `connecting`
    // rather than `connected` because its terminal state has not been
    // recorded yet. Test fixtures and persistence restores are the only
    // expected callers that can construct this shape.
    // should hit this branch.
    const repo = emptyRepo(REMOTE_ID, 'remote', 'repo-runtime-test')
    expect(deriveConnectivity(repo)).toBe('connecting')
  })
})
