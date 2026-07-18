import type {
  ServerTerminalCreateInput,
  ServerTerminalCreateResult,
} from '#/server/terminal/terminal-session-creator.ts'
import { terminalExecutionCoordinates, terminalExecutionPath } from '#/shared/terminal-types.ts'
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
    input: ServerTerminalCreateInput,
    admission: TerminalCreateAdmission,
  ): Promise<ServerTerminalCreateResult>
}

interface TerminalSessionAdmittedCreateService {
  createAdmitted(
    clientId: string,
    userId: string,
    input: ServerTerminalCreateInput,
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
      const coordinates = terminalExecutionCoordinates(input.target)
      assertPhysicalWorktreeExecutionCapability(admission.physicalWorktreeCapability, {
        userId,
        repoRoot: coordinates.repoRoot,
        repoRuntimeId: coordinates.repoRuntimeId,
        worktreePath: terminalExecutionPath(input.target),
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
