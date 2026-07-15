import PQueue from 'p-queue'
import {
  physicalWorktreeIdentityKey,
  type PhysicalWorktreeIdentity,
} from '#/server/worktree-removal/physical-worktree-identity.ts'
import {
  physicalWorktreeAdmissionLease,
  physicalWorktreeAdmissionLeaseSignal,
  validatePhysicalWorktreeExecution,
  type PhysicalWorktreeAdmissionLease,
  type PhysicalWorktreeExecutionCapability,
} from '#/server/worktree-removal/physical-worktree-identity-resolver.ts'

export type PhysicalWorktreeAdmissionTarget =
  | PhysicalWorktreeAdmissionLease
  | PhysicalWorktreeExecutionCapability
  | PhysicalWorktreeIdentity

export interface PhysicalWorktreeOperationPermit {
  readonly operationId: number
}

export interface PhysicalWorktreeOperationContext {
  readonly signal: AbortSignal
}

export interface PhysicalWorktreeAdmissionBatch {
  readonly capabilities: readonly PhysicalWorktreeExecutionCapability[]
  readonly leases: readonly PhysicalWorktreeAdmissionLease[]
}

/** Serializes runtime mutations and removal admission by physical worktree identity. */
export class PhysicalWorktreeOperationCoordinator {
  private readonly queues = new Map<string, PQueue>()
  private readonly removalAdmissions = new Set<string>()
  private readonly permitContexts = new WeakMap<
    PhysicalWorktreeOperationPermit,
    { capability: PhysicalWorktreeExecutionCapability; key: string; context: PhysicalWorktreeOperationContext }
  >()
  private readonly activePermits = new WeakSet<PhysicalWorktreeOperationPermit>()
  private nextOperationId = 1

  isRemovalAdmitted(target: PhysicalWorktreeAdmissionTarget): boolean {
    return this.removalAdmissions.has(physicalWorktreeOperationKey(target))
  }

  assertPermit(
    capability: PhysicalWorktreeExecutionCapability,
    permit: PhysicalWorktreeOperationPermit,
  ): PhysicalWorktreeOperationContext {
    const entry = this.permitContexts.get(permit)
    if (!this.activePermits.has(permit) || entry?.capability !== capability) {
      throw new Error('error.invalid-worktree-operation-permit')
    }
    return entry.context
  }

  async runOperation<T>(
    capability: PhysicalWorktreeExecutionCapability,
    task: (permit: PhysicalWorktreeOperationPermit, context: PhysicalWorktreeOperationContext) => Promise<T>,
    externalSignal?: AbortSignal,
  ): Promise<{ admitted: true; value: T } | { admitted: false }> {
    const admissionLease = physicalWorktreeAdmissionLease(capability)
    const signal = combinedSignal(physicalWorktreeAdmissionLeaseSignal(admissionLease), externalSignal)
    signal.throwIfAborted()
    const key = physicalWorktreeOperationKey(capability)
    if (this.removalAdmissions.has(key)) return { admitted: false }
    const context = Object.freeze({ signal })
    const permit = this.createPermit(capability, key, context)
    try {
      return {
        admitted: true,
        value: await this.runByKey(
          key,
          async () => {
            await validatePhysicalWorktreeExecution(capability, signal)
            signal.throwIfAborted()
            return await task(permit, context)
          },
          signal,
        ),
      }
    } finally {
      this.activePermits.delete(permit)
    }
  }

  async runIndexReconciliation<T>(
    lease: PhysicalWorktreeAdmissionLease,
    task: () => Promise<T>,
    externalSignal?: AbortSignal,
  ): Promise<{ admitted: true; value: T } | { admitted: false }> {
    const signal = combinedSignal(physicalWorktreeAdmissionLeaseSignal(lease), externalSignal)
    signal.throwIfAborted()
    const key = physicalWorktreeOperationKey(lease)
    if (this.removalAdmissions.has(key)) return { admitted: false }
    return {
      admitted: true,
      value: await this.runByKey(key, async () => {
        signal.throwIfAborted()
        return await task()
      }, signal),
    }
  }

  /** Acquire each stable physical identity once, while validating the newest capability available for it. */
  async runAdmissionBatch<T>(
    batch: PhysicalWorktreeAdmissionBatch,
    task: () => Promise<T>,
    externalSignal?: AbortSignal,
  ): Promise<{ admitted: true; value: T } | { admitted: false }> {
    const capabilitiesByKey = new Map<string, PhysicalWorktreeExecutionCapability>()
    for (const capability of batch.capabilities) {
      capabilitiesByKey.set(physicalWorktreeOperationKey(capability), capability)
    }
    const leasesByKey = new Map<string, PhysicalWorktreeAdmissionLease>()
    for (const lease of batch.leases) {
      const key = physicalWorktreeOperationKey(lease)
      if (!leasesByKey.has(key)) leasesByKey.set(key, lease)
    }
    const keys = [...new Set([...capabilitiesByKey.keys(), ...leasesByKey.keys()])].sort()
    if (keys.some((key) => this.removalAdmissions.has(key))) return { admitted: false }
    const acquire = async (index: number): Promise<T> => {
      const key = keys[index]
      if (!key) return await task()
      const capability = capabilitiesByKey.get(key)
      const lease = capability ? physicalWorktreeAdmissionLease(capability) : leasesByKey.get(key)
      if (!lease) throw new Error('error.invalid-worktree-admission-lease')
      const signal = combinedSignal(physicalWorktreeAdmissionLeaseSignal(lease), externalSignal)
      return await this.runByKey(key, async () => {
        signal.throwIfAborted()
        if (capability) await validatePhysicalWorktreeExecution(capability, signal)
        return await acquire(index + 1)
      }, signal)
    }
    const firstCapability = keys.length > 0 ? capabilitiesByKey.get(keys[0]) : undefined
    const firstLease = firstCapability
      ? physicalWorktreeAdmissionLease(firstCapability)
      : (keys.length > 0 ? leasesByKey.get(keys[0])! : null)
    if (firstLease) {
      combinedSignal(physicalWorktreeAdmissionLeaseSignal(firstLease), externalSignal).throwIfAborted()
    }
    return { admitted: true, value: await acquire(0) }
  }

  async runRemoval<T>(
    capability: PhysicalWorktreeExecutionCapability,
    task: (context: PhysicalWorktreeOperationContext, permit: PhysicalWorktreeOperationPermit) => Promise<T>,
    externalSignal?: AbortSignal,
  ): Promise<{ admitted: true; value: T } | { admitted: false }> {
    const admissionLease = physicalWorktreeAdmissionLease(capability)
    const signal = combinedSignal(physicalWorktreeAdmissionLeaseSignal(admissionLease), externalSignal)
    signal.throwIfAborted()
    const key = physicalWorktreeOperationKey(capability)
    if (this.removalAdmissions.has(key)) return { admitted: false }
    this.removalAdmissions.add(key)
    const context = Object.freeze({ signal })
    const permit = this.createPermit(capability, key, context)
    try {
      return {
        admitted: true,
        value: await this.runByKey(
          key,
          async () => {
            await validatePhysicalWorktreeExecution(capability, signal)
            signal.throwIfAborted()
            return await task(context, permit)
          },
          signal,
        ),
      }
    } finally {
      this.activePermits.delete(permit)
      this.removalAdmissions.delete(key)
    }
  }

  private async runByKey<T>(key: string, task: () => Promise<T>, signal: AbortSignal): Promise<T> {
    const queue = this.queue(key)
    try {
      return await queue.add(task, { signal })
    } finally {
      void queue.onIdle().then(() => {
        if (this.queues.get(key) !== queue) return
        if (queue.size === 0 && queue.pending === 0) this.queues.delete(key)
      })
    }
  }

  private queue(key: string): PQueue {
    let queue = this.queues.get(key)
    if (!queue) {
      queue = new PQueue({ concurrency: 1 })
      this.queues.set(key, queue)
    }
    return queue
  }

  private createPermit(
    capability: PhysicalWorktreeExecutionCapability,
    key: string,
    context: PhysicalWorktreeOperationContext,
  ): PhysicalWorktreeOperationPermit {
    const permit = { operationId: this.nextOperationId++ }
    this.permitContexts.set(permit, { capability, key, context })
    this.activePermits.add(permit)
    return permit
  }
}

function combinedSignal(runtimeSignal: AbortSignal, externalSignal: AbortSignal | undefined): AbortSignal {
  return externalSignal ? AbortSignal.any([runtimeSignal, externalSignal]) : runtimeSignal
}

function physicalWorktreeOperationKey(target: PhysicalWorktreeAdmissionTarget): string {
  return physicalWorktreeIdentityKey('identity' in target ? target.identity : target)
}

export function createPhysicalWorktreeOperationCoordinator(): PhysicalWorktreeOperationCoordinator {
  return new PhysicalWorktreeOperationCoordinator()
}
