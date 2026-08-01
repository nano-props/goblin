import { beforeEach, describe, expect, test } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { createGitWorkspaceProbeForTest } from '#/web/test-utils/repo-store.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { emptyWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { acceptWorkspaceRuntimeSnapshot } from '#/web/stores/workspaces/workspace-runtime-projection.ts'

const workspaceId = workspaceIdForTest('goblin+file:///workspace/runtime-projection')
const workspaceRuntimeId = 'repo-runtime-projection-test'

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
})
