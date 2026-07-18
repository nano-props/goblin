import { describe, expect, test, vi } from 'vitest'
import { createTerminalSessionCreateProvider } from '#/server/terminal/terminal-session-create-provider.ts'
import { createPhysicalWorktreeOperationCoordinator } from '#/server/worktree-removal/physical-worktree-operation-coordinator.ts'
import { testPhysicalWorktreeExecutionCapability } from '#/server/test-utils/physical-worktree-identity.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'

const workspaceId = requiredWorkspaceLocator('goblin+file:///repo')
const worktreeRoot = requiredWorkspaceLocator('goblin+file:///repo/expected')

function requiredWorkspaceLocator(input: string) {
  const locator = canonicalWorkspaceLocator(input)
  if (!locator) throw new Error('invalid workspace locator fixture')
  return locator
}

describe('terminal session create provider', () => {
  test('rejects an active permit issued for a different physical worktree', async () => {
    const createAdmitted = vi.fn()
    const worktreeOperations = createPhysicalWorktreeOperationCoordinator()
    const provider = createTerminalSessionCreateProvider({
      sessionService: { createAdmitted },
      worktreeOperations,
    })
    const expectedIdentity = testPhysicalWorktreeExecutionCapability('/repo/expected', {
      userId: 'user-test',
      repoRoot: workspaceId,
      repoRuntimeId: 'repo-runtime-test',
    })
    const wrongIdentity = testPhysicalWorktreeExecutionCapability('/repo/wrong')

    await worktreeOperations.runOperation(wrongIdentity, async (permit) => {
      await expect(
        provider.createAdmitted('client-test', 'user-test', createRequest(), {
          physicalWorktreeCapability: expectedIdentity,
          permit,
        }),
      ).rejects.toThrow('error.invalid-worktree-operation-permit')
      return null
    })
    expect(createAdmitted).not.toHaveBeenCalled()
  })
})

function createRequest() {
  return {
    target: { kind: 'git-worktree' as const, workspaceId, workspaceRuntimeId: 'repo-runtime-test', root: worktreeRoot },
    kind: 'primary' as const,
    cols: 80,
    rows: 24,
  }
}
