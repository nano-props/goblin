import {
  physicalWorktreeIdentityKey,
  type PhysicalWorktreeIdentity,
} from '#/server/worktree-removal/physical-worktree-identity.ts'
import {
  physicalWorktreeAdmissionLease,
  physicalWorktreeAdmissionLeaseKey,
  type PhysicalWorktreeAdmissionLease,
  type PhysicalWorktreeExecutionCapability,
} from '#/server/worktree-removal/physical-worktree-capability.ts'

export function uniqueSortedCapabilities(
  capabilities: readonly PhysicalWorktreeExecutionCapability[],
): PhysicalWorktreeExecutionCapability[] {
  return Array.from(
    new Map(
      [...capabilities]
        .sort((left, right) =>
          physicalWorktreeAdmissionLeaseKey(physicalWorktreeAdmissionLease(left)).localeCompare(
            physicalWorktreeAdmissionLeaseKey(physicalWorktreeAdmissionLease(right)),
          ),
        )
        .map((capability) => [
          physicalWorktreeAdmissionLeaseKey(physicalWorktreeAdmissionLease(capability)),
          capability,
        ]),
    ).values(),
  )
}

export function uniqueSortedAdmissionLeases(
  leases: readonly PhysicalWorktreeAdmissionLease[],
): PhysicalWorktreeAdmissionLease[] {
  return Array.from(
    new Map(
      [...leases]
        .sort((left, right) =>
          physicalWorktreeAdmissionLeaseKey(left).localeCompare(physicalWorktreeAdmissionLeaseKey(right)),
        )
        .map((lease) => [physicalWorktreeAdmissionLeaseKey(lease), lease]),
    ).values(),
  )
}

export function capabilitiesByIdentity(
  capabilities: readonly PhysicalWorktreeExecutionCapability[],
): Map<string, PhysicalWorktreeExecutionCapability> {
  return new Map(
    capabilities.map((capability) => [
      physicalWorktreeAdmissionLeaseKey(physicalWorktreeAdmissionLease(capability)),
      capability,
    ]),
  )
}

export function mergeCurrentCapabilities(
  existing: ReadonlyMap<string, PhysicalWorktreeExecutionCapability>,
  current: readonly PhysicalWorktreeExecutionCapability[],
): Map<string, PhysicalWorktreeExecutionCapability> {
  const currentStableKeys = new Set(current.map((capability) => physicalWorktreeIdentityKey(capability.identity)))
  return new Map([
    ...[...existing].filter(
      ([, capability]) => !currentStableKeys.has(physicalWorktreeIdentityKey(capability.identity)),
    ),
    ...capabilitiesByIdentity(current),
  ])
}

export function admissionRecords(
  leases: readonly PhysicalWorktreeAdmissionLease[],
  capabilities: readonly PhysicalWorktreeExecutionCapability[],
) {
  const byStableIdentity = new Map<
    string,
    {
      identity: PhysicalWorktreeIdentity
      currentCapability: PhysicalWorktreeExecutionCapability | null
      indexedLeases: PhysicalWorktreeAdmissionLease[]
    }
  >()
  for (const lease of leases) {
    const key = physicalWorktreeIdentityKey(lease.identity)
    const record = byStableIdentity.get(key) ?? {
      identity: lease.identity,
      currentCapability: null,
      indexedLeases: [],
    }
    record.indexedLeases.push(lease)
    byStableIdentity.set(key, record)
  }
  for (const capability of capabilities) {
    const key = physicalWorktreeIdentityKey(capability.identity)
    const record = byStableIdentity.get(key) ?? {
      identity: capability.identity,
      currentCapability: null,
      indexedLeases: [],
    }
    // Admission lease keys are derived from the stable physical identity.
    // Repeated captures therefore represent the same admission target; retain
    // the latest execution capability for that identity.
    record.currentCapability = capability
    byStableIdentity.set(key, record)
  }
  return [...byStableIdentity.values()]
}
