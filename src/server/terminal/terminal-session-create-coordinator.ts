import PQueue from 'p-queue'
import type { TerminalCreateInput, TerminalSessionSummary } from '#/shared/terminal-types.ts'
import { createTerminalSessionId } from '#/server/terminal/terminal-session-ids.ts'
import { terminalSessionUserWorktreeKey } from '#/shared/terminal-session-keys.ts'

type TerminalCreateKind = TerminalCreateInput['kind']

interface TerminalSessionCreateManager {
  listSessionsForUser(userId: string, scope: string): Promise<TerminalSessionSummary[]>
}

interface TerminalSessionCreateCoordinatorOptions {
  manager: TerminalSessionCreateManager
  createSessionId?: () => string
}

interface TerminalSessionCreateWorktreeInput {
  userId: string
  scope: string
  worktreePath: string
}

interface TerminalSessionCreateAllocationInput extends TerminalSessionCreateWorktreeInput {
  kind: TerminalCreateKind
}

interface TerminalSessionIdAllocation {
  terminalSessionId: string
  reservationKey: string | null
}

class TerminalSessionCreateCoordinator {
  private readonly manager: TerminalSessionCreateManager
  private readonly createSessionId: () => string
  private readonly createQueuesByUserWorktree = new Map<string, PQueue>()
  private readonly reservedTerminalSessionIdsByWorktree = new Map<string, Set<string>>()

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
    const allocation = await this.allocateSessionIdForCreate(input)
    try {
      return await task({ terminalSessionId: allocation.terminalSessionId })
    } finally {
      this.releaseSessionIdReservation(allocation)
    }
  }

  private async allocateSessionIdForCreate(
    input: TerminalSessionCreateAllocationInput,
  ): Promise<TerminalSessionIdAllocation> {
    const sessions = await this.manager.listSessionsForUser(input.userId, input.scope)
    const existingSession = sessions.find((session) => session.worktreePath === input.worktreePath)
    if (input.kind === 'primary' && existingSession) {
      return { terminalSessionId: existingSession.terminalSessionId, reservationKey: null }
    }
    const reservationKey = terminalSessionUserWorktreeKey(input)
    const reservedTerminalSessionId = this.reservedTerminalSessionIdsByWorktree
      .get(reservationKey)
      ?.values()
      .next().value
    if (input.kind === 'primary' && reservedTerminalSessionId) {
      return { terminalSessionId: reservedTerminalSessionId, reservationKey: null }
    }
    return { terminalSessionId: this.reserveNewSessionId(reservationKey), reservationKey }
  }

  private reserveNewSessionId(reservationKey: string): string {
    let reserved = this.reservedTerminalSessionIdsByWorktree.get(reservationKey)
    if (!reserved) {
      reserved = new Set()
      this.reservedTerminalSessionIdsByWorktree.set(reservationKey, reserved)
    }
    const terminalSessionId = this.createSessionId()
    reserved.add(terminalSessionId)
    return terminalSessionId
  }

  private releaseSessionIdReservation(allocation: TerminalSessionIdAllocation): void {
    if (!allocation.reservationKey) return
    const reserved = this.reservedTerminalSessionIdsByWorktree.get(allocation.reservationKey)
    if (!reserved) return
    reserved.delete(allocation.terminalSessionId)
    if (reserved.size === 0) this.reservedTerminalSessionIdsByWorktree.delete(allocation.reservationKey)
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
