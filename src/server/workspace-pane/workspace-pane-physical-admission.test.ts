import { describe, expect, test } from 'vitest'
import {
  issueTestPhysicalWorktreeExecutionCapability,
  testPhysicalWorktreeIdentity,
} from '#/server/test-utils/physical-worktree-identity.ts'
import {
  physicalWorktreeAdmissionLease,
  physicalWorktreeAdmissionLeaseKey,
} from '#/server/worktree-removal/physical-worktree-capability.ts'
import {
  admissionRecords,
  capabilitiesByIdentity,
  mergeCurrentCapabilities,
  uniqueSortedAdmissionLeases,
  uniqueSortedCapabilities,
} from '#/server/workspace-pane/workspace-pane-physical-admission.ts'

describe('workspace pane physical admission policy', () => {
  test('sorts and deduplicates capabilities and leases by admission identity', () => {
    const identityA = testPhysicalWorktreeIdentity('/workspace/a')
    const identityB = testPhysicalWorktreeIdentity('/workspace/b')
    const oldA = issueTestPhysicalWorktreeExecutionCapability({ identity: identityA })
    const currentA = issueTestPhysicalWorktreeExecutionCapability({ identity: identityA })
    const currentB = issueTestPhysicalWorktreeExecutionCapability({ identity: identityB })

    expect(uniqueSortedCapabilities([currentB, oldA, currentA])).toEqual([currentA, currentB])
    expect(
      uniqueSortedAdmissionLeases([
        physicalWorktreeAdmissionLease(currentB),
        physicalWorktreeAdmissionLease(oldA),
        physicalWorktreeAdmissionLease(currentA),
      ]),
    ).toEqual([physicalWorktreeAdmissionLease(currentA), physicalWorktreeAdmissionLease(currentB)])
  })

  test('replaces stale capabilities by stable identity while preserving unrelated capabilities', () => {
    const identityA = testPhysicalWorktreeIdentity('/workspace/a')
    const oldA = issueTestPhysicalWorktreeExecutionCapability({ identity: identityA })
    const currentA = issueTestPhysicalWorktreeExecutionCapability({ identity: identityA })
    const currentB = issueTestPhysicalWorktreeExecutionCapability({
      identity: testPhysicalWorktreeIdentity('/workspace/b'),
    })

    const merged = mergeCurrentCapabilities(capabilitiesByIdentity([oldA, currentB]), [currentA])

    expect([...merged.values()]).toEqual([currentB, currentA])
    expect(merged.get(physicalWorktreeAdmissionLeaseKey(physicalWorktreeAdmissionLease(oldA)))).toBe(currentA)
  })

  test('groups indexed leases and the current capability by stable physical identity', () => {
    const identity = testPhysicalWorktreeIdentity('/workspace/a')
    const indexed = issueTestPhysicalWorktreeExecutionCapability({ identity })
    const current = issueTestPhysicalWorktreeExecutionCapability({ identity })
    const lease = physicalWorktreeAdmissionLease(indexed)

    expect(admissionRecords([lease], [current])).toEqual([
      {
        identity,
        currentCapability: current,
        indexedLeases: [lease],
      },
    ])
  })

  test('collapses repeated captures of one admission identity to the latest capability', () => {
    const identity = testPhysicalWorktreeIdentity('/workspace/a')
    const first = issueTestPhysicalWorktreeExecutionCapability({ identity })
    const second = issueTestPhysicalWorktreeExecutionCapability({ identity })

    expect(admissionRecords([], [first, second])).toEqual([
      {
        identity,
        currentCapability: second,
        indexedLeases: [],
      },
    ])
  })
})
