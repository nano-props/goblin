import { describe, expect, test, vi } from 'vitest'
import { CodedError } from '#/shared/coded-error.ts'
import {
  assertWorkspaceCapabilityTransitionCommitted,
  commitWorkspaceCapabilityTransitionOrThrow,
} from '#/server/workspace-capability-transition-host.ts'
import { testWorkspaceRuntimeEpochCapability } from '#/server/test-utils/workspace-runtime-capability.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import type { WorkspaceSettledProbeState } from '#/shared/workspace-runtime.ts'

const plainProbe: WorkspaceSettledProbeState = {
  status: 'ready',
  capabilities: {
    files: { read: true, write: true },
    terminal: { available: true },
    git: { status: 'unavailable' },
  },
  diagnostics: [],
}
const gitProbe: WorkspaceSettledProbeState = {
  ...plainProbe,
  capabilities: {
    ...plainProbe.capabilities,
    git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
  },
}
const runtimeCapability = testWorkspaceRuntimeEpochCapability({
  userId: 'user-test',
  workspaceId: workspaceIdForTest('goblin+file:///workspace'),
  workspaceRuntimeId: 'runtime-test',
})

describe('workspace capability transition host', () => {
  test('dispatches capability promotion and removal to their explicit host operations', async () => {
    const commitGitCapabilityPromotion = vi.fn(async () => ({ kind: 'committed' as const }))
    const commitGitCapabilityRemoval = vi.fn(async () => ({ kind: 'committed' as const }))
    const host = { commitGitCapabilityPromotion, commitGitCapabilityRemoval }

    await commitWorkspaceCapabilityTransitionOrThrow(host, {
      runtimeCapability,
      before: plainProbe,
      after: gitProbe,
    })
    await commitWorkspaceCapabilityTransitionOrThrow(host, {
      runtimeCapability,
      before: gitProbe,
      after: plainProbe,
    })

    expect(commitGitCapabilityPromotion).toHaveBeenCalledOnce()
    expect(commitGitCapabilityPromotion).toHaveBeenCalledWith({ runtimeCapability })
    expect(commitGitCapabilityRemoval).toHaveBeenCalledOnce()
    expect(commitGitCapabilityRemoval).toHaveBeenCalledWith({ runtimeCapability })
  })

  test('surfaces post-durable authority failure as an uncertain operation', () => {
    const cause = new Error('terminal authority commit failed')

    expect(() =>
      assertWorkspaceCapabilityTransitionCommitted({
        kind: 'committed-authority-uncertain',
        error: cause,
      }),
    ).toThrowError(
      expect.objectContaining({
        name: CodedError.name,
        code: 'OUTCOME_UNCERTAIN',
        message: 'error.operation-outcome-uncertain',
        cause,
      }),
    )
  })
})
