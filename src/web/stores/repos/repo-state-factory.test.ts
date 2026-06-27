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
    const repo = emptyRepo('/tmp/local-repo', 'local')
    expect(deriveConnectivity(repo)).toBe('connected')
  })

  test('a remote repo with lifecycle=connecting reads as connecting', () => {
    const repo = emptyRepo(REMOTE_ID, 'remote')
    repo.remote.lifecycle = { kind: 'connecting' }
    expect(deriveConnectivity(repo)).toBe('connecting')
  })

  test('a remote repo with lifecycle=ready reads as connected', () => {
    const repo = emptyRepo(REMOTE_ID, 'remote')
    const target = remoteTargetFixture()
    repo.remote.lifecycle = { kind: 'ready', target }
    expect(deriveConnectivity(repo)).toBe('connected')
  })

  test('a remote repo with lifecycle=failed reads as unreachable', () => {
    const repo = emptyRepo(REMOTE_ID, 'remote')
    repo.remote.lifecycle = { kind: 'failed', reason: 'unreachable' }
    expect(deriveConnectivity(repo)).toBe('unreachable')
  })

  test('a remote repo with lifecycle=failed but a retained target still reads as unreachable', () => {
    const repo = emptyRepo(REMOTE_ID, 'remote')
    const target = remoteTargetFixture()
    repo.remote.lifecycle = { kind: 'failed', reason: 'timeout', target }
    expect(deriveConnectivity(repo)).toBe('unreachable')
  })

  test('a remote repo with no lifecycle reads as connecting (post-Phase-4 default)', () => {
    // Phase 4 deleted the legacy `availability.phase` / `target`
    // fallback. A remote repo without a lifecycle is treated as
    // `connecting` rather than `connected` — its terminal state
    // hasn't been recorded yet. Test fixtures, persistence
    // restores, or any non-migrated write path that lands a
    // remote repo with no lifecycle are the only callers that
    // should hit this branch.
    const repo = emptyRepo(REMOTE_ID, 'remote')
    expect(deriveConnectivity(repo)).toBe('connecting')
  })
})
