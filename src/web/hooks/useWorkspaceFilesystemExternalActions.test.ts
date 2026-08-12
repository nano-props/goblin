import { seedRepoWithReadModelForTest, resetWorkspacesStore } from '#/web/test-utils/repo-store.ts'
import { beforeEach, describe, expect, test } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { workspaceRootPaneFilesystemTarget } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import { runWorkspaceFilesystemExternalAction } from '#/web/hooks/useWorkspaceFilesystemExternalActions.ts'
import { CodedError } from '#/shared/coded-error.ts'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///tmp/filesystem-external-action')
const WORKSPACE_RUNTIME_ID = 'workspace-runtime-filesystem-external-action'

describe('workspace filesystem external action lifecycle', () => {
  beforeEach(() => {
    resetWorkspacesStore()
  })

  test('returns an outcome while the target runtime lease remains current', async () => {
    seedRepoWithReadModelForTest({ id: WORKSPACE_ID, workspaceRuntimeId: WORKSPACE_RUNTIME_ID })
    const target = workspaceRootTarget(WORKSPACE_RUNTIME_ID)

    await expect(
      runWorkspaceFilesystemExternalAction(target, async () => ({ ok: false, message: 'external app failed' })),
    ).resolves.toEqual({ ok: false, message: 'external app failed' })
  })

  test('drops a stale outcome after the workspace runtime is replaced', async () => {
    seedRepoWithReadModelForTest({ id: WORKSPACE_ID, workspaceRuntimeId: WORKSPACE_RUNTIME_ID })
    const target = workspaceRootTarget(WORKSPACE_RUNTIME_ID)
    const action = Promise.withResolvers<{ ok: false; message: string }>()
    const result = runWorkspaceFilesystemExternalAction(target, async () => await action.promise)

    seedRepoWithReadModelForTest({ id: WORKSPACE_ID, workspaceRuntimeId: 'workspace-runtime-replacement' })
    action.resolve({ ok: false, message: 'stale external app failure' })

    await expect(result).resolves.toBeNull()
  })

  test('preserves an uncertain external command error while the target remains current', async () => {
    seedRepoWithReadModelForTest({ id: WORKSPACE_ID, workspaceRuntimeId: WORKSPACE_RUNTIME_ID })
    const target = workspaceRootTarget(WORKSPACE_RUNTIME_ID)

    await expect(
      runWorkspaceFilesystemExternalAction(target, async () => {
        throw new CodedError({ code: 'OUTCOME_UNCERTAIN', message: 'response lost' })
      }),
    ).rejects.toMatchObject({ code: 'OUTCOME_UNCERTAIN' })
  })
})

function workspaceRootTarget(workspaceRuntimeId: string) {
  return workspaceRootPaneFilesystemTarget({
    workspaceId: WORKSPACE_ID,
    workspaceRuntimeId,
    capabilities: {
      files: { read: true, write: true },
      terminal: { available: true },
      git: { status: 'unavailable' },
    },
  })
}
