import PQueue from 'p-queue'
import {
  physicalWorktreeIdentity,
  physicalWorktreeIdentityKey,
} from '#/server/worktree-removal/physical-worktree-identity.ts'

export interface PhysicalWorktreeOperationTarget {
  repoRoot: string
  worktreePath: string
}

export interface PhysicalWorktreeOperationPermit {
  readonly operationId: number
}

/** Serializes runtime mutations and removal admission by physical worktree identity. */
export class PhysicalWorktreeOperationCoordinator {
  private readonly queues = new Map<string, PQueue>()
  private readonly removalAdmissions = new Set<string>()
  private readonly permitKeys = new WeakMap<PhysicalWorktreeOperationPermit, string>()
  private readonly activePermits = new WeakSet<PhysicalWorktreeOperationPermit>()
  private nextOperationId = 1

  isRemovalAdmitted(target: PhysicalWorktreeOperationTarget): boolean {
    return this.removalAdmissions.has(physicalWorktreeOperationKey(target))
  }

  assertPermit(target: PhysicalWorktreeOperationTarget, permit: PhysicalWorktreeOperationPermit): void {
    if (!this.activePermits.has(permit) || this.permitKeys.get(permit) !== physicalWorktreeOperationKey(target)) {
      throw new Error('error.invalid-worktree-operation-permit')
    }
  }

  async runOperation<T>(
    target: PhysicalWorktreeOperationTarget,
    task: (permit: PhysicalWorktreeOperationPermit) => Promise<T>,
  ): Promise<{ admitted: true; value: T } | { admitted: false }> {
    const key = physicalWorktreeOperationKey(target)
    if (this.removalAdmissions.has(key)) return { admitted: false }
    const permit = this.createPermit(key)
    try {
      return { admitted: true, value: await this.runByKey(key, async () => await task(permit)) }
    } finally {
      this.activePermits.delete(permit)
    }
  }

  async runRemoval<T>(
    target: PhysicalWorktreeOperationTarget,
    task: () => Promise<T>,
  ): Promise<{ admitted: true; value: T } | { admitted: false }> {
    const key = physicalWorktreeOperationKey(target)
    if (this.removalAdmissions.has(key)) return { admitted: false }
    this.removalAdmissions.add(key)
    try {
      return { admitted: true, value: await this.runByKey(key, task) }
    } finally {
      this.removalAdmissions.delete(key)
    }
  }

  private async runByKey<T>(key: string, task: () => Promise<T>): Promise<T> {
    const queue = this.queue(key)
    try {
      return await queue.add(task)
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

  private createPermit(key: string): PhysicalWorktreeOperationPermit {
    const permit = { operationId: this.nextOperationId++ }
    this.permitKeys.set(permit, key)
    this.activePermits.add(permit)
    return permit
  }
}

function physicalWorktreeOperationKey(target: PhysicalWorktreeOperationTarget): string {
  return physicalWorktreeIdentityKey(physicalWorktreeIdentity(target))
}

export function createPhysicalWorktreeOperationCoordinator(): PhysicalWorktreeOperationCoordinator {
  return new PhysicalWorktreeOperationCoordinator()
}
