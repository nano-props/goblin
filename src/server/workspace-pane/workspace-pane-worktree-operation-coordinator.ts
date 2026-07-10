import PQueue from 'p-queue'
import { terminalSessionUserWorktreeKey } from '#/shared/terminal-session-keys.ts'

export interface WorkspacePaneWorktreeOperationTarget {
  userId: string
  scope: string
  worktreePath: string
}

/**
 * Owns ordering for application commands that mutate one worktree's runtime
 * resources. A removal admission is visible before the command reaches the
 * queue, so later opens and tab writes cannot slip in behind the removal.
 */
export class WorkspacePaneWorktreeOperationCoordinator {
  private readonly queues = new Map<string, PQueue>()
  private readonly removalAdmissions = new Set<string>()

  isRemovalAdmitted(target: WorkspacePaneWorktreeOperationTarget): boolean {
    return this.removalAdmissions.has(terminalSessionUserWorktreeKey(target))
  }

  assertWritable(target: WorkspacePaneWorktreeOperationTarget): void {
    if (this.isRemovalAdmitted(target)) throw new Error('error.worktree-removal-in-progress')
  }

  async runOperation<T>(target: WorkspacePaneWorktreeOperationTarget, task: () => Promise<T>): Promise<T> {
    return await this.runByKey(terminalSessionUserWorktreeKey(target), task)
  }

  async runRemoval<T>(
    target: WorkspacePaneWorktreeOperationTarget,
    task: () => Promise<T>,
  ): Promise<{ admitted: true; value: T } | { admitted: false }> {
    const key = terminalSessionUserWorktreeKey(target)
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

export function createWorkspacePaneWorktreeOperationCoordinator(): WorkspacePaneWorktreeOperationCoordinator {
  return new WorkspacePaneWorktreeOperationCoordinator()
}
