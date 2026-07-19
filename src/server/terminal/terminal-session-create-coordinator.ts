import PQueue from 'p-queue'
import type { TerminalCreateInput } from '#/shared/terminal-types.ts'
import { createTerminalSessionId } from '#/server/terminal/terminal-session-ids.ts'
import { terminalSessionUserFilesystemTargetKey } from '#/shared/terminal-session-keys.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

type TerminalCreateKind = TerminalCreateInput['kind']

interface TerminalSessionCreateManager {
  primaryTerminalSessionIdForFilesystemTarget(
    userId: string,
    scope: string,
    executionRootId: WorkspaceId,
  ): string | null
}

interface TerminalSessionCreateCoordinatorOptions {
  manager: TerminalSessionCreateManager
  createSessionId?: () => string
}

interface TerminalSessionCreateFilesystemTargetInput {
  userId: string
  scope: string
  executionRootId: WorkspaceId
}

interface TerminalSessionCreateAllocationInput extends TerminalSessionCreateFilesystemTargetInput {
  kind: TerminalCreateKind
}

class TerminalSessionCreateCoordinator {
  private readonly manager: TerminalSessionCreateManager
  private readonly createSessionId: () => string
  private readonly createQueuesByUserFilesystemTarget = new Map<string, PQueue>()

  constructor(options: TerminalSessionCreateCoordinatorOptions) {
    this.manager = options.manager
    this.createSessionId = options.createSessionId ?? createTerminalSessionId
  }

  async runInFilesystemTargetQueue<T>(
    input: TerminalSessionCreateFilesystemTargetInput,
    task: () => Promise<T>,
  ): Promise<T> {
    const queueKey = terminalSessionUserFilesystemTargetKey(input)
    const queue = this.createQueueForUserFilesystemTarget(queueKey)
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

  private async allocateSessionIdForCreate(input: TerminalSessionCreateAllocationInput): Promise<string> {
    if (input.kind === 'primary') {
      const existingSessionId = this.manager.primaryTerminalSessionIdForFilesystemTarget(
        input.userId,
        input.scope,
        input.executionRootId,
      )
      if (existingSessionId) return existingSessionId
    }
    return this.createSessionId()
  }

  private createQueueForUserFilesystemTarget(queueKey: string): PQueue {
    let queue = this.createQueuesByUserFilesystemTarget.get(queueKey)
    if (!queue) {
      queue = new PQueue({ concurrency: 1 })
      this.createQueuesByUserFilesystemTarget.set(queueKey, queue)
    }
    return queue
  }

  private scheduleCreateQueueCleanup(queueKey: string, queue: PQueue): void {
    void queue.onIdle().then(() => {
      if (this.createQueuesByUserFilesystemTarget.get(queueKey) !== queue) return
      if (queue.size === 0 && queue.pending === 0) this.createQueuesByUserFilesystemTarget.delete(queueKey)
    })
  }
}

export function createTerminalSessionCreateCoordinator(
  options: TerminalSessionCreateCoordinatorOptions,
): TerminalSessionCreateCoordinator {
  return new TerminalSessionCreateCoordinator(options)
}
