import type { TerminalCreateInput, TerminalCreateResult } from '#/shared/terminal-types.ts'
import {
  assertPhysicalWorktreeCapability,
  type PhysicalWorktreeCapability,
} from '#/server/worktree-removal/physical-worktree-identity-resolver.ts'
import type {
  PhysicalWorktreeOperationCoordinator,
  PhysicalWorktreeOperationPermit,
} from '#/server/worktree-removal/physical-worktree-operation-coordinator.ts'

export interface TerminalCreateAdmission {
  physicalWorktreeCapability: PhysicalWorktreeCapability
  permit: PhysicalWorktreeOperationPermit
}

export interface ServerTerminalCreateProvider {
  createAdmitted(
    clientId: string,
    userId: string,
    input: TerminalCreateInput,
    admission: TerminalCreateAdmission,
  ): Promise<TerminalCreateResult>
}

interface TerminalSessionAdmittedCreateService {
  createAdmitted(
    clientId: string,
    userId: string,
    input: TerminalCreateInput,
    physicalWorktreeCapability: PhysicalWorktreeCapability,
    signal: AbortSignal,
  ): Promise<TerminalCreateResult>
}

export function createTerminalSessionCreateProvider(deps: {
  sessionService: TerminalSessionAdmittedCreateService
  worktreeOperations: Pick<PhysicalWorktreeOperationCoordinator, 'assertPermit'>
}): ServerTerminalCreateProvider {
  return {
    async createAdmitted(clientId, userId, input, admission) {
      assertPhysicalWorktreeCapability(admission.physicalWorktreeCapability, {
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
