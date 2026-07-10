import PQueue from 'p-queue'
import { terminalSessionScope, terminalSessionWorktreePath } from '#/server/terminal/terminal-session-scope.ts'

export interface PhysicalWorktreeOperationTarget {
  repoRoot: string
  worktreePath: string
}

/** Serializes runtime mutations and removal admission by physical worktree identity. */
export class PhysicalWorktreeOperationCoordinator {
  private readonly queues = new Map<string, PQueue>()
  private readonly removalAdmissions = new Set<string>()

  isRemovalAdmitted(target: PhysicalWorktreeOperationTarget): boolean {
    return this.removalAdmissions.has(physicalWorktreeOperationKey(target))
  }

  assertWritable(target: PhysicalWorktreeOperationTarget): void {
    if (this.isRemovalAdmitted(target)) throw new Error('error.worktree-removal-in-progress')
  }

  async runOperation<T>(target: PhysicalWorktreeOperationTarget, task: () => Promise<T>): Promise<T> {
    return await this.runByKey(physicalWorktreeOperationKey(target), task)
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
}

function physicalWorktreeOperationKey(target: PhysicalWorktreeOperationTarget): string {
  return `${terminalSessionScope(target.repoRoot)}\0${terminalSessionWorktreePath(target.repoRoot, target.worktreePath)}`
}

export function createPhysicalWorktreeOperationCoordinator(): PhysicalWorktreeOperationCoordinator {
  return new PhysicalWorktreeOperationCoordinator()
}
