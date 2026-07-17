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
} from '#/server/worktree-removal/physical-worktree-capability.ts'

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

export interface PhysicalWorktreeAdmissionRecord {
  readonly identity: PhysicalWorktreeIdentity
  readonly currentCapability: PhysicalWorktreeExecutionCapability | null
  readonly indexedLeases: readonly PhysicalWorktreeAdmissionLease[]
}

/** Serializes runtime mutations and removal admission by physical worktree identity. */
export class PhysicalWorktreeOperationCoordinator {
  private readonly queues = new Map<string, PQueue>()
  private readonly removalAdmissions = new Set<string>()
  private readonly batchAdmissions = new Map<string, number>()
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

  /** Acquire each stable physical identity once, while validating the newest capability available for it. */
  async runAdmissionBatch<T>(
    records: readonly PhysicalWorktreeAdmissionRecord[],
    task: () => Promise<T>,
    externalSignal?: AbortSignal,
  ): Promise<{ admitted: true; value: T } | { admitted: false }> {
    const normalized = normalizeAdmissionRecords(records)
    const keys = normalized.map(({ key }) => key)
    if (!this.reserveBatch(keys)) return { admitted: false }
    try {
      const selectedLeases = normalized.map((record) => {
        if (record.currentCapability) return physicalWorktreeAdmissionLease(record.currentCapability)
        return record.indexedLeases.find((candidate) => !physicalWorktreeAdmissionLeaseSignal(candidate).aborted) ??
          record.indexedLeases[0]
      })
      const batchSignals = selectedLeases.map((lease) => {
        if (!lease) throw new Error('error.invalid-worktree-admission-record')
        return physicalWorktreeAdmissionLeaseSignal(lease)
      })
      if (externalSignal) batchSignals.push(externalSignal)
      const batchSignal = AbortSignal.any(batchSignals)
      const acquire = async (index: number): Promise<T> => {
        const record = normalized[index]
        if (!record) return await task()
        const { key, currentCapability: capability } = record
        return await this.runByKey(key, async () => {
          batchSignal.throwIfAborted()
          if (capability) await validatePhysicalWorktreeExecution(capability, batchSignal)
          return await acquire(index + 1)
        }, batchSignal)
      }
      batchSignal.throwIfAborted()
      return { admitted: true, value: await acquire(0) }
    } finally {
      this.releaseBatch(keys)
    }
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
    if (this.removalAdmissions.has(key) || this.batchAdmissions.has(key)) return { admitted: false }
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

  private reserveBatch(keys: readonly string[]): boolean {
    if (keys.some((key) => this.removalAdmissions.has(key))) return false
    for (const key of keys) this.batchAdmissions.set(key, (this.batchAdmissions.get(key) ?? 0) + 1)
    return true
  }

  private releaseBatch(keys: readonly string[]): void {
    for (const key of keys) {
      const count = this.batchAdmissions.get(key)
      if (count === undefined) throw new Error('physical worktree batch admission underflow')
      if (count === 1) this.batchAdmissions.delete(key)
      else this.batchAdmissions.set(key, count - 1)
    }
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

function normalizeAdmissionRecords(records: readonly PhysicalWorktreeAdmissionRecord[]): Array<
  PhysicalWorktreeAdmissionRecord & { key: string }
> {
  const byKey = new Map<string, PhysicalWorktreeAdmissionRecord & { key: string }>()
  for (const record of records) {
    const key = physicalWorktreeIdentityKey(record.identity)
    if (byKey.has(key)) throw new Error('error.duplicate-worktree-admission-record')
    if (record.currentCapability && physicalWorktreeOperationKey(record.currentCapability) !== key) {
      throw new Error('error.invalid-worktree-admission-record')
    }
    if (record.indexedLeases.some((lease) => physicalWorktreeOperationKey(lease) !== key)) {
      throw new Error('error.invalid-worktree-admission-record')
    }
    if (!record.currentCapability && record.indexedLeases.length === 0) {
      throw new Error('error.invalid-worktree-admission-record')
    }
    byKey.set(key, { ...record, key })
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key))
}

export function createPhysicalWorktreeOperationCoordinator(): PhysicalWorktreeOperationCoordinator {
  return new PhysicalWorktreeOperationCoordinator()
}
