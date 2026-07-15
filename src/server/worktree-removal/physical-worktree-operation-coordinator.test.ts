import { describe, expect, test } from 'vitest'
import { createPhysicalWorktreeOperationCoordinator } from '#/server/worktree-removal/physical-worktree-operation-coordinator.ts'
import {
  issueTestPhysicalWorktreeExecutionCapability,
  testPhysicalWorktreeIdentity,
} from '#/server/test-utils/physical-worktree-identity.ts'
import { physicalWorktreeAdmissionLease } from '#/server/worktree-removal/physical-worktree-identity-resolver.ts'

describe('physical worktree operation coordinator', () => {
  test('admits one queue for multiple generations of the same identity', async () => {
    const identity = testPhysicalWorktreeIdentity('/repo/worktree')
    const oldCapability = issueTestPhysicalWorktreeExecutionCapability({
      identity,
      execution: {
        kind: 'local', canonicalWorktreePath: identity.endpoint,
        endpointMarker: { deviceId: '1', inode: '1' },
      },
    })
    const currentCapability = issueTestPhysicalWorktreeExecutionCapability({
      identity,
      execution: {
        kind: 'local', canonicalWorktreePath: identity.endpoint,
        endpointMarker: { deviceId: '1', inode: '2' },
      },
    })
    const coordinator = createPhysicalWorktreeOperationCoordinator()
    let executions = 0

    await expect(coordinator.runAdmissionBatch({
      capabilities: [currentCapability],
      leases: [physicalWorktreeAdmissionLease(oldCapability)],
    }, async () => {
      executions += 1
      return 'ok'
    })).resolves.toEqual({ admitted: true, value: 'ok' })
    expect(executions).toBe(1)
  })
})
