import { describe, expect, test, vi } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import type { WorkspacePaneTabsSnapshot } from '#/shared/workspace-pane-tabs.ts'
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
      markFailed: vi.fn(),
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
      markFailed: vi.fn(),
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
      markFailed: vi.fn(),
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

  test('publishes a failed projection once when the active recovery request fails', async () => {
    const error = new Error('tabs unavailable')
    const markFailed = vi.fn()
    const logFailure = vi.fn()
    const recovery = new WorkspacePaneTabsRecovery({
      list: vi.fn(async () => await Promise.reject(error)),
      commit: vi.fn(),
      markFailed,
      currentRevision: () => null,
      logFailure,
    })

    recovery.request(new RuntimeProjectionScope(TARGET, () => true))

    await vi.waitFor(() => expect(markFailed).toHaveBeenCalledWith(TARGET, error))
    expect(markFailed).toHaveBeenCalledOnce()
    expect(logFailure).toHaveBeenCalledWith(TARGET, error)
  })

  test('does not publish failure after the runtime scope is replaced', async () => {
    const request = Promise.withResolvers<WorkspacePaneTabsSnapshot>()
    let current = true
    const markFailed = vi.fn()
    const recovery = new WorkspacePaneTabsRecovery({
      list: vi.fn(async () => await request.promise),
      commit: vi.fn(),
      markFailed,
      currentRevision: () => null,
      logFailure: vi.fn(),
    })
    const scope = new RuntimeProjectionScope(TARGET, () => current)

    recovery.request(scope)
    current = false
    request.reject(new Error('stale failure'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(markFailed).not.toHaveBeenCalled()
  })
})
