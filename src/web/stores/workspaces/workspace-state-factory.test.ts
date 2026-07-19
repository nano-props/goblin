import { describe, expect, test } from 'vitest'
import { normalizeRemoteTarget } from '#/shared/remote-workspace.ts'
import { emptyWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { deriveWorkspaceConnectivity } from '#/web/stores/workspaces/workspace-guards.ts'
import { acceptWorkspaceProbeState } from '#/web/stores/workspaces/workspace-guards.ts'
import { requireRemoteAdmissionForTest } from '#/web/stores/workspaces/git-workspace-projection.test-utils.ts'

const REMOTE_ID = 'goblin+ssh://example/srv/repo'

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

describe('deriveWorkspaceConnectivity', () => {
  test('rejects a non-canonical workspace identity at aggregate creation', () => {
    expect(() => emptyWorkspace('/workspace', 'workspace', 'workspace-runtime-test')).toThrow(
      'Workspace state requires a canonical workspace ID',
    )
  })

  test('creates a capability-neutral local workspace shell', () => {
    const workspace = emptyWorkspace('goblin+file:///workspace', 'workspace', 'workspace-runtime-test')

    expect(workspace.admission).toEqual({ kind: 'local' })
    expect(workspace.capability).toEqual({ kind: 'probing', probe: { status: 'probing' } })
  })

  test('creates and clears the Git projection only at probe acceptance', () => {
    const workspace = emptyWorkspace('goblin+file:///workspace', 'workspace', 'workspace-runtime-test')
    acceptWorkspaceProbeState(workspace, {
      status: 'ready',
      name: 'workspace',
      capabilities: {
        files: { read: true, write: true },
        terminal: { available: true },
        git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
      },
      diagnostics: [],
    })

    expect(workspace.capability.kind).toBe('git')
    if (workspace.capability.kind !== 'git') throw new Error('Expected Git capability')
    expect(workspace.capability.git.dataLoads.repoReadModel.phase).toBe('idle')
    expect(workspace.capability.git.operations.repoReadModel.phase).toBe('idle')
    expect(workspace.capability.git.ui).toEqual({ branchViewMode: 'all' })
    expect(workspace.capability.git.projection).toEqual({ source: 'fresh', savedAt: null })
    expect(workspace.capability.git.remote.fetchFailed).toBe(false)
    expect(workspace.capability.git.events).toEqual([])

    acceptWorkspaceProbeState(workspace, {
      status: 'ready',
      name: 'workspace',
      capabilities: {
        files: { read: true, write: true },
        terminal: { available: true },
        git: { status: 'unavailable' },
      },
      diagnostics: [],
    })
    expect(workspace.capability.kind).toBe('filesystem')
  })

  test('preserves the accepted Git projection across a same-capability probe refresh', () => {
    const workspace = emptyWorkspace('goblin+file:///workspace', 'workspace', 'workspace-runtime-test')
    const gitProbe = {
      status: 'ready' as const,
      name: 'workspace',
      capabilities: {
        files: { read: true as const, write: true },
        terminal: { available: true },
        git: { status: 'available' as const, worktrees: true, pullRequests: { provider: 'none' as const } },
      },
      diagnostics: [],
    }
    acceptWorkspaceProbeState(workspace, gitProbe)
    if (workspace.capability.kind !== 'git') throw new Error('Expected Git capability')
    const acceptedProjection = workspace.capability.git
    acceptedProjection.remote.fetchFailed = true

    acceptWorkspaceProbeState(workspace, { ...gitProbe, name: 'workspace-refreshed' })

    if (workspace.capability.kind !== 'git') throw new Error('Expected Git capability')
    expect(workspace.capability.git).toBe(acceptedProjection)
    expect(workspace.capability.git.remote.fetchFailed).toBe(true)
    expect(workspace.capability.probe.name).toBe('workspace-refreshed')
  })

  test.each([
    [{ status: 'probing' as const }, 'probing'],
    [{ status: 'unavailable' as const, reason: 'error.workspace-path-not-found' as const }, 'unavailable'],
  ])('discards Git authority when the probe transitions to %s', (nextProbe, expectedKind) => {
    const workspace = emptyWorkspace('goblin+file:///workspace', 'workspace', 'workspace-runtime-test')
    acceptWorkspaceProbeState(workspace, {
      status: 'ready',
      name: 'workspace',
      capabilities: {
        files: { read: true, write: true },
        terminal: { available: true },
        git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
      },
      diagnostics: [],
    })

    acceptWorkspaceProbeState(workspace, nextProbe)

    expect(workspace.capability.kind).toBe(expectedKind)
    expect('git' in workspace.capability).toBe(false)
  })

  test('local workspaces always read as connected', () => {
    const repo = emptyWorkspace('goblin+file:///tmp/local-repo', 'local', 'repo-runtime-test')
    expect(deriveWorkspaceConnectivity(repo)).toBe('connected')
  })

  test('a remote workspace with lifecycle=connecting reads as connecting', () => {
    const repo = emptyWorkspace(REMOTE_ID, 'remote', 'repo-runtime-test')
    requireRemoteAdmissionForTest(repo).lifecycle = { kind: 'connecting' }
    expect(deriveWorkspaceConnectivity(repo)).toBe('connecting')
  })

  test('a remote workspace with lifecycle=ready reads as connected', () => {
    const repo = emptyWorkspace(REMOTE_ID, 'remote', 'repo-runtime-test')
    const target = remoteTargetFixture()
    requireRemoteAdmissionForTest(repo).lifecycle = { kind: 'ready', target }
    expect(deriveWorkspaceConnectivity(repo)).toBe('connected')
  })

  test('a remote workspace with lifecycle=failed reads as unreachable', () => {
    const repo = emptyWorkspace(REMOTE_ID, 'remote', 'repo-runtime-test')
    requireRemoteAdmissionForTest(repo).lifecycle = { kind: 'failed', reason: 'unreachable' }
    expect(deriveWorkspaceConnectivity(repo)).toBe('unreachable')
  })

  test('a remote workspace with lifecycle=failed but a retained target still reads as unreachable', () => {
    const repo = emptyWorkspace(REMOTE_ID, 'remote', 'repo-runtime-test')
    const target = remoteTargetFixture()
    requireRemoteAdmissionForTest(repo).lifecycle = { kind: 'failed', reason: 'timeout', target }
    expect(deriveWorkspaceConnectivity(repo)).toBe('unreachable')
  })

  test('a remote workspace with no lifecycle reads as connecting', () => {
    // A remote repo without a lifecycle is treated as `connecting`
    // rather than `connected` because its terminal state has not been
    // recorded yet. Test fixtures and persistence restores are the only
    // expected callers that can construct this shape.
    // should hit this branch.
    const repo = emptyWorkspace(REMOTE_ID, 'remote', 'repo-runtime-test')
    expect(deriveWorkspaceConnectivity(repo)).toBe('connecting')
  })

  test('rejects a remote identity with local transport admission', () => {
    const workspace = emptyWorkspace(REMOTE_ID, 'remote', 'workspace-runtime-test')
    workspace.admission = { kind: 'local' }

    expect(() => deriveWorkspaceConnectivity(workspace)).toThrow(
      'Remote workspace identity requires remote transport admission',
    )
  })
})
