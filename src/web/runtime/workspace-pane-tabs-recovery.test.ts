import { describe, expect, test, vi } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { RuntimeProjectionScope } from '#/web/runtime/runtime-projection-scope.ts'
import { WorkspacePaneTabsRecovery } from '#/web/runtime/workspace-pane-tabs-recovery.ts'

const TARGET = {
  workspaceId: workspaceIdForTest('goblin+file:///workspace'),
  workspaceRuntimeId: 'workspace-runtime-current',
}

describe('WorkspacePaneTabsRecovery', () => {
  test('refreshes the query-owned projection for the active runtime scope', async () => {
    const refresh = vi.fn(async () => {})
    const recovery = new WorkspacePaneTabsRecovery({
      refresh,
      currentRevision: () => null,
      logFailure: vi.fn(),
    })

    recovery.request(new RuntimeProjectionScope(TARGET, () => true), { kind: 'fresh' })
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledWith(TARGET, { kind: 'fresh' }))
  })

  test('skips a revision event already represented by the cache', () => {
    const refresh = vi.fn(async () => {})
    const recovery = new WorkspacePaneTabsRecovery({
      refresh,
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

    expect(refresh).not.toHaveBeenCalled()
  })

  test('refreshes when an event belongs to a replaced runtime epoch', async () => {
    const refresh = vi.fn(async () => {})
    const recovery = new WorkspacePaneTabsRecovery({
      refresh,
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

    await vi.waitFor(() => expect(refresh).toHaveBeenCalledWith(TARGET, { kind: 'fresh' }))
  })

  test('reruns after an in-flight refresh when a newer revision is announced', async () => {
    const firstRefresh = Promise.withResolvers<void>()
    const refresh = vi.fn().mockImplementationOnce(async () => await firstRefresh.promise).mockResolvedValue(undefined)
    const recovery = new WorkspacePaneTabsRecovery({
      refresh,
      currentRevision: () => 4,
      logFailure: vi.fn(),
    })
    const scope = new RuntimeProjectionScope(TARGET, () => true)

    recovery.request(scope, { kind: 'fresh' })
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce())
    recovery.handleChanged(scope, {
      type: 'workspace-pane-tabs.changed',
      workspaceId: TARGET.workspaceId,
      workspaceRuntimeId: TARGET.workspaceRuntimeId,
      change: 'revision',
      revision: 5,
    })
    firstRefresh.resolve()

    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2))
    expect(refresh).toHaveBeenLastCalledWith(TARGET, { kind: 'minimum-revision', revision: 5 })
  })

  test('logs a query-owned refresh failure for the active runtime scope', async () => {
    const error = new Error('tabs unavailable')
    const logFailure = vi.fn()
    const recovery = new WorkspacePaneTabsRecovery({
      refresh: vi.fn(async () => await Promise.reject(error)),
      currentRevision: () => null,
      logFailure,
    })

    recovery.request(new RuntimeProjectionScope(TARGET, () => true), { kind: 'fresh' })

    await vi.waitFor(() => expect(logFailure).toHaveBeenCalledWith(TARGET, error))
  })

  test('does not log a refresh failure after the runtime scope is replaced', async () => {
    const request = Promise.withResolvers<void>()
    let current = true
    const logFailure = vi.fn()
    const recovery = new WorkspacePaneTabsRecovery({
      refresh: vi.fn(async () => await request.promise),
      currentRevision: () => null,
      logFailure,
    })
    const scope = new RuntimeProjectionScope(TARGET, () => current)

    recovery.request(scope, { kind: 'fresh' })
    current = false
    request.reject(new Error('stale failure'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(logFailure).not.toHaveBeenCalled()
  })
})
