import PQueue from 'p-queue'
import type { TerminalCreateInput } from '#/shared/terminal-types.ts'
import { createTerminalSessionId } from '#/server/terminal/terminal-session-ids.ts'
import { terminalSessionUserWorktreeKey } from '#/shared/terminal-session-keys.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

type TerminalCreateKind = TerminalCreateInput['kind']

interface TerminalSessionCreateManager {
  primaryTerminalSessionIdForWorktree(userId: string, scope: string, worktreeId: WorkspaceId): string | null
}

interface TerminalSessionCreateCoordinatorOptions {
  manager: TerminalSessionCreateManager
  createSessionId?: () => string
}

interface TerminalSessionCreateWorktreeInput {
  userId: string
  scope: string
  worktreeId: WorkspaceId
}

interface TerminalSessionCreateAllocationInput extends TerminalSessionCreateWorktreeInput {
  kind: TerminalCreateKind
}

class TerminalSessionCreateCoordinator {
  private readonly manager: TerminalSessionCreateManager
  private readonly createSessionId: () => string
  private readonly createQueuesByUserWorktree = new Map<string, PQueue>()

  constructor(options: TerminalSessionCreateCoordinatorOptions) {
    this.manager = options.manager
    this.createSessionId = options.createSessionId ?? createTerminalSessionId
  }

  async runInWorktreeQueue<T>(input: TerminalSessionCreateWorktreeInput, task: () => Promise<T>): Promise<T> {
    const queueKey = terminalSessionUserWorktreeKey(input)
    const queue = this.createQueueForUserWorktree(queueKey)
    try {
      return await queue.add(task)
    } finally {
      this.scheduleCreateQueueCleanup(queueKey, queue)
    }
  }

  async withSessionIdAllocation<T>(
    input: TerminalSessionCreateAllocationInput,
    task: (allocation: { terminalSessionId: string }) => Promise<T>,
  ): Promise<T> {
    return await task({ terminalSessionId: await this.allocateSessionIdForCreate(input) })
  }

  private async allocateSessionIdForCreate(
    input: TerminalSessionCreateAllocationInput,
  ): Promise<string> {
    if (input.kind === 'primary') {
      const existingSessionId = this.manager.primaryTerminalSessionIdForWorktree(
        input.userId,
        input.scope,
        input.worktreeId,
      )
      if (existingSessionId) return existingSessionId
    }
    return this.createSessionId()
  }

  private createQueueForUserWorktree(queueKey: string): PQueue {
    let queue = this.createQueuesByUserWorktree.get(queueKey)
    if (!queue) {
      queue = new PQueue({ concurrency: 1 })
      this.createQueuesByUserWorktree.set(queueKey, queue)
    }
    return queue
  }

  private scheduleCreateQueueCleanup(queueKey: string, queue: PQueue): void {
    void queue.onIdle().then(() => {
      if (this.createQueuesByUserWorktree.get(queueKey) !== queue) return
      if (queue.size === 0 && queue.pending === 0) this.createQueuesByUserWorktree.delete(queueKey)
    })
  }
}

export function createTerminalSessionCreateCoordinator(
  options: TerminalSessionCreateCoordinatorOptions,
): TerminalSessionCreateCoordinator {
  return new TerminalSessionCreateCoordinator(options)
}
