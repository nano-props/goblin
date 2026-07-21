import { describe, expect, test, vi } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { RuntimeProjectionScope } from '#/web/runtime/runtime-projection-scope.ts'
import { WorkspacePaneTabsRecovery } from '#/web/runtime/workspace-pane-tabs-recovery.ts'

const TARGET = {
  workspaceId: workspaceIdForTest('goblin+file:///workspace'),
  workspaceRuntimeId: 'workspace-runtime-current',
}

describe('WorkspacePaneTabsRecovery', () => {
  test('publishes the canonical snapshot for the active runtime scope', async () => {
    const snapshot = { revision: 3, entries: [] }
    const list = vi.fn(async () => snapshot)
    const commit = vi.fn()
    const recovery = new WorkspacePaneTabsRecovery({
      list,
      commit,
      currentRevision: () => null,
      logFailure: vi.fn(),
    })

    recovery.request(new RuntimeProjectionScope(TARGET, () => true))
    await vi.waitFor(() => expect(commit).toHaveBeenCalledWith(TARGET, snapshot))
    expect(list).toHaveBeenCalledWith(TARGET)
  })

  test('skips a revision event already represented by the cache', () => {
    const list = vi.fn(async () => ({ revision: 4, entries: [] }))
    const recovery = new WorkspacePaneTabsRecovery({
      list,
      commit: vi.fn(),
      currentRevision: () => 4,
      logFailure: vi.fn(),
    })
    const scope = new RuntimeProjectionScope(TARGET, () => true)

    recovery.handleChanged(scope, {
      type: 'workspace-pane-tabs.changed',
      workspaceId: TARGET.workspaceId,
      workspaceRuntimeId: TARGET.workspaceRuntimeId,
      change: 'revision',
      revision: 4,
    })

    expect(list).not.toHaveBeenCalled()
  })

  test('refreshes when an event belongs to a replaced runtime epoch', async () => {
    const list = vi.fn(async () => ({ revision: 5, entries: [] }))
    const commit = vi.fn()
    const recovery = new WorkspacePaneTabsRecovery({
      list,
      commit,
      currentRevision: () => 99,
      logFailure: vi.fn(),
    })
    const scope = new RuntimeProjectionScope(TARGET, () => true)

    recovery.handleChanged(scope, {
      type: 'workspace-pane-tabs.changed',
      workspaceId: TARGET.workspaceId,
      workspaceRuntimeId: 'workspace-runtime-replaced',
      change: 'revision',
      revision: 1,
    })

    await vi.waitFor(() => expect(commit).toHaveBeenCalled())
  })
})
