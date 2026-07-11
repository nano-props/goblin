import PQueue from 'p-queue'
import {
  physicalWorktreeIdentityKey,
  type PhysicalWorktreeIdentity,
} from '#/server/worktree-removal/physical-worktree-identity.ts'
import {
  physicalWorktreeCapabilityLease,
  type PhysicalWorktreeCapability,
} from '#/server/worktree-removal/physical-worktree-identity-resolver.ts'

export type PhysicalWorktreeAdmissionTarget = PhysicalWorktreeCapability | PhysicalWorktreeIdentity

export interface PhysicalWorktreeOperationPermit {
  readonly operationId: number
}

export interface PhysicalWorktreeOperationContext {
  readonly signal: AbortSignal
}

/** Serializes runtime mutations and removal admission by physical worktree identity. */
export class PhysicalWorktreeOperationCoordinator {
  private readonly queues = new Map<string, PQueue>()
  private readonly removalAdmissions = new Set<string>()
  private readonly permitContexts = new WeakMap<
    PhysicalWorktreeOperationPermit,
    { capability: PhysicalWorktreeCapability; key: string; context: PhysicalWorktreeOperationContext }
  >()
  private readonly activePermits = new WeakSet<PhysicalWorktreeOperationPermit>()
  private nextOperationId = 1

  isRemovalAdmitted(target: PhysicalWorktreeAdmissionTarget): boolean {
    return this.removalAdmissions.has(physicalWorktreeOperationKey(target))
  }

  assertPermit(
    capability: PhysicalWorktreeCapability,
    permit: PhysicalWorktreeOperationPermit,
  ): PhysicalWorktreeOperationContext {
    const entry = this.permitContexts.get(permit)
    if (!this.activePermits.has(permit) || entry?.capability !== capability) {
      throw new Error('error.invalid-worktree-operation-permit')
    }
    return entry.context
  }

  async runOperation<T>(
    capability: PhysicalWorktreeCapability,
    task: (permit: PhysicalWorktreeOperationPermit, context: PhysicalWorktreeOperationContext) => Promise<T>,
    externalSignal?: AbortSignal,
  ): Promise<{ admitted: true; value: T } | { admitted: false }> {
    const lease = physicalWorktreeCapabilityLease(capability)
    const signal = combinedSignal(lease.runtimeSignal, externalSignal)
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
            await lease.validateExecution(signal)
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

  async runRemoval<T>(
    capability: PhysicalWorktreeCapability,
    task: (context: PhysicalWorktreeOperationContext, permit: PhysicalWorktreeOperationPermit) => Promise<T>,
    externalSignal?: AbortSignal,
  ): Promise<{ admitted: true; value: T } | { admitted: false }> {
    const lease = physicalWorktreeCapabilityLease(capability)
    const signal = combinedSignal(lease.runtimeSignal, externalSignal)
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
            await lease.validateExecution(signal)
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
    capability: PhysicalWorktreeCapability,
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
