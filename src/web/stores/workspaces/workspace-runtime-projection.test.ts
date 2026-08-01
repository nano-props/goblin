import { beforeEach, describe, expect, test } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { normalizeRemoteTarget } from '#/shared/remote-workspace.ts'
import { createGitWorkspaceProbeForTest } from '#/web/test-utils/repo-store.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { emptyWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { acceptWorkspaceRuntimeSnapshot } from '#/web/stores/workspaces/workspace-runtime-projection.ts'

const workspaceId = workspaceIdForTest('goblin+file:///workspace/runtime-projection')
const workspaceRuntimeId = 'repo-runtime-projection-test'
const remoteWorkspaceId = workspaceIdForTest('goblin+ssh://example/runtime-projection')
const remoteWorkspaceRuntimeId = 'remote-runtime-projection-test'
const otherRemoteWorkspaceId = workspaceIdForTest('goblin+ssh://other/runtime-projection')
const target = normalizeRemoteTarget({
  alias: 'example',
  host: 'example.test',
  user: 'developer',
  port: 22,
  remotePath: '/workspace',
})!

describe('workspace runtime snapshot projection', () => {
  beforeEach(() => {
    const workspace = emptyWorkspace(workspaceId, workspaceRuntimeId)
    useWorkspacesStore.setState({ workspaces: { [workspaceId]: workspace }, workspaceOrder: [workspaceId] })
  })

  test('projects a local runtime probe without remote lifecycle state', () => {
    acceptWorkspaceRuntimeSnapshot(useWorkspacesStore.setState, useWorkspacesStore.getState, {
      runtimes: [{ workspaceId, workspaceRuntimeId, workspaceProbe: createGitWorkspaceProbeForTest() }],
    })

    const workspace = useWorkspacesStore.getState().workspaces[workspaceId]
    expect(workspace?.capability.kind).toBe('git')
    expect(workspace?.admission.kind).toBe('local')
  })

  test('projects a fresh probe when the remote lifecycle is stale', () => {
    const workspace = emptyWorkspace(remoteWorkspaceId, remoteWorkspaceRuntimeId)
    useWorkspacesStore.setState({
      workspaces: { [remoteWorkspaceId]: workspace },
      workspaceOrder: [remoteWorkspaceId],
    })
    acceptWorkspaceRuntimeSnapshot(useWorkspacesStore.setState, useWorkspacesStore.getState, {
      runtimes: [
        {
          workspaceId: remoteWorkspaceId,
          workspaceRuntimeId: remoteWorkspaceRuntimeId,
          workspaceProbe: createGitWorkspaceProbeForTest(),
          remoteLifecycle: { kind: 'ready', attemptId: 2, target },
        },
      ],
    })

    acceptWorkspaceRuntimeSnapshot(useWorkspacesStore.setState, useWorkspacesStore.getState, {
      runtimes: [
        {
          workspaceId: remoteWorkspaceId,
          workspaceRuntimeId: remoteWorkspaceRuntimeId,
          workspaceProbe: { status: 'unavailable', reason: 'error.workspace-transport-unavailable' },
          remoteLifecycle: { kind: 'connecting', attemptId: 1 },
        },
      ],
    })

    const updated = useWorkspacesStore.getState().workspaces[remoteWorkspaceId]
    expect(updated?.capability.kind).toBe('unavailable')
    expect(updated?.admission).toMatchObject({
      kind: 'remote',
      lifecycle: { kind: 'ready', target },
    })
  })

  test('projects only runtime entries represented by this window', () => {
    const workspace = emptyWorkspace(remoteWorkspaceId, remoteWorkspaceRuntimeId)
    useWorkspacesStore.setState({
      workspaces: { [remoteWorkspaceId]: workspace },
      workspaceOrder: [remoteWorkspaceId],
    })

    acceptWorkspaceRuntimeSnapshot(useWorkspacesStore.setState, useWorkspacesStore.getState, {
      runtimes: [
        {
          workspaceId: remoteWorkspaceId,
          workspaceRuntimeId: remoteWorkspaceRuntimeId,
          workspaceProbe: createGitWorkspaceProbeForTest(),
          remoteLifecycle: { kind: 'ready', attemptId: 1, target },
        },
        {
          workspaceId: otherRemoteWorkspaceId,
          workspaceRuntimeId: 'remote-runtime-other',
          workspaceProbe: { status: 'probing' },
          remoteLifecycle: { kind: 'failed', attemptId: 4, reason: 'timeout' },
        },
      ],
    })

    const updated = useWorkspacesStore.getState().workspaces[remoteWorkspaceId]
    expect(updated?.capability.kind).toBe('git')
    expect(updated?.admission).toMatchObject({
      kind: 'remote',
      lifecycle: { kind: 'ready', target },
    })
    expect(useWorkspacesStore.getState().workspaces[otherRemoteWorkspaceId]).toBeUndefined()
  })
})
