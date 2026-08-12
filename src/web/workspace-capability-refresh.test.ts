import { beforeEach, describe, expect, test, vi } from 'vitest'
import { CodedError } from '#/shared/coded-error.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { refreshWorkspace } from '#/web/workspace-client.ts'
import {
  cancelWorkspaceCapabilityRefreshes,
  requestWorkspaceCapabilityRefresh,
} from '#/web/workspace-capability-refresh.ts'

vi.mock('#/web/workspace-client.ts', () => ({ refreshWorkspace: vi.fn() }))

describe('workspace capability refresh outcome', () => {
  beforeEach(() => {
    vi.mocked(refreshWorkspace).mockReset()
  })

  test('does not hide an uncertain command outcome behind cancellation', async () => {
    const workspaceId = workspaceIdForTest('goblin+file:///workspace')
    const workspaceRuntimeId = 'workspace-runtime-test'
    vi.mocked(refreshWorkspace).mockImplementation(async (_workspaceId, _workspaceRuntimeId, signal) => {
      await new Promise<void>((_resolve, reject) => {
        signal?.addEventListener(
          'abort',
          () => reject(new CodedError({ code: 'OUTCOME_UNCERTAIN', message: 'workspace refresh outcome uncertain' })),
          { once: true },
        )
      })
      throw new Error('unreachable')
    })

    const refresh = requestWorkspaceCapabilityRefresh(workspaceId, workspaceRuntimeId)
    await vi.waitFor(() => expect(refreshWorkspace).toHaveBeenCalledOnce())
    cancelWorkspaceCapabilityRefreshes(workspaceId, workspaceRuntimeId)

    await expect(refresh).resolves.toEqual({ kind: 'outcome-uncertain' })
  })
})
