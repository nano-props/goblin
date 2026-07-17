import type { TerminalCreateInput, TerminalCreateResult } from '#/shared/terminal-types.ts'
import type { ServerTerminalCreateResult } from '#/server/terminal/terminal-session-creator.ts'
import {
  assertPhysicalWorktreeExecutionCapability,
  type PhysicalWorktreeExecutionCapability,
} from '#/server/worktree-removal/physical-worktree-capability.ts'
import type {
  PhysicalWorktreeOperationCoordinator,
  PhysicalWorktreeOperationPermit,
} from '#/server/worktree-removal/physical-worktree-operation-coordinator.ts'

export interface TerminalCreateAdmission {
  physicalWorktreeCapability: PhysicalWorktreeExecutionCapability
  permit: PhysicalWorktreeOperationPermit
}

export interface ServerTerminalCreateProvider {
  createAdmitted(
    clientId: string,
    userId: string,
    input: TerminalCreateInput,
    admission: TerminalCreateAdmission,
  ): Promise<ServerTerminalCreateResult>
}

interface TerminalSessionAdmittedCreateService {
  createAdmitted(
    clientId: string,
    userId: string,
    input: TerminalCreateInput,
    physicalWorktreeCapability: PhysicalWorktreeExecutionCapability,
    signal: AbortSignal,
  ): Promise<ServerTerminalCreateResult>
}

export function createTerminalSessionCreateProvider(deps: {
  sessionService: TerminalSessionAdmittedCreateService
  worktreeOperations: Pick<PhysicalWorktreeOperationCoordinator, 'assertPermit'>
}): ServerTerminalCreateProvider {
  return {
    async createAdmitted(clientId, userId, input, admission) {
      assertPhysicalWorktreeExecutionCapability(admission.physicalWorktreeCapability, {
        userId,
        repoRoot: input.repoRoot,
        repoRuntimeId: input.repoRuntimeId,
        worktreePath: input.worktreePath,
      })
      const context = deps.worktreeOperations.assertPermit(admission.physicalWorktreeCapability, admission.permit)
      return await deps.sessionService.createAdmitted(
        clientId,
        userId,
        input,
        admission.physicalWorktreeCapability,
        context.signal,
      )
    },
  }
}
