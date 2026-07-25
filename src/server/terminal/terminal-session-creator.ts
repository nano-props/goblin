import {
  terminalExecutionCoordinates,
  type TerminalCreateInput,
  type TerminalCreateResult,
} from '#/shared/terminal-types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { terminalSessionRuntimeScope } from '#/server/terminal/terminal-session-scope.ts'
import type {
  TerminalSessionEnsureInput,
  TerminalSessionEnsureResult,
} from '#/server/terminal/terminal-session-ensurer.ts'
import type { createTerminalSessionCreateCoordinator } from '#/server/terminal/terminal-session-create-coordinator.ts'
import type { PhysicalWorktreeExecutionCapability } from '#/server/worktree-removal/physical-worktree-capability.ts'

type TerminalSessionCreateCoordinator = ReturnType<typeof createTerminalSessionCreateCoordinator>
type TerminalCreateFailure = Extract<TerminalCreateResult, { ok: false }>
export type ServerTerminalCreateResult =
  | {
      ok: true
      terminalSessionId: string
      terminalRuntimeSessionId: string
      admission: Extract<TerminalSessionEnsureResult, { ok: true }>['admission']
    }
  | TerminalCreateFailure

export type ServerTerminalCreateInput = TerminalCreateInput

interface TerminalSessionCreatorOptions {
  createCoordinator: TerminalSessionCreateCoordinator
  ensureOrRestore(
    clientId: string,
    userId: string,
    input: TerminalSessionEnsureInput,
    physicalWorktreeCapability: PhysicalWorktreeExecutionCapability,
    signal: AbortSignal,
  ): Promise<TerminalSessionEnsureResult>
  isCurrentWorkspaceRuntime(userId: string, workspaceId: WorkspaceId, workspaceRuntimeId: string): boolean
}

class TerminalSessionCreator {
  private readonly options: TerminalSessionCreatorOptions

  constructor(options: TerminalSessionCreatorOptions) {
    this.options = options
  }

  async create(input: {
    clientId: string
    userId: string
    request: ServerTerminalCreateInput
    physicalWorktreeCapability: PhysicalWorktreeExecutionCapability
    signal: AbortSignal
  }): Promise<ServerTerminalCreateResult> {
    const signal = input.signal
    const coordinates = terminalExecutionCoordinates(input.request.target)
    const sessionScope = terminalSessionRuntimeScope(coordinates.workspaceId, coordinates.workspaceRuntimeId)
    const executionRootId = coordinates.executionRootId
    return await this.options.createCoordinator.runInFilesystemTargetQueue(
      { userId: input.userId, scope: sessionScope, executionRootId },
      async () => {
        if (signal.aborted) return { ok: false, message: 'error.workspace-runtime-stale' }
        if (
          !this.options.isCurrentWorkspaceRuntime(input.userId, coordinates.workspaceId, coordinates.workspaceRuntimeId)
        ) {
          return { ok: false, message: 'error.workspace-runtime-stale' }
        }
        const createResult = await this.options.createCoordinator.withSessionIdAllocation(
          { userId: input.userId, scope: sessionScope, executionRootId, kind: input.request.kind },
          async ({ terminalSessionId }) =>
            await this.options.ensureOrRestore(
              input.clientId,
              input.userId,
              {
                ...input.request,
                terminalSessionId,
              },
              input.physicalWorktreeCapability,
              signal,
            ),
        )
        if (!createResult.ok) return { ok: false, message: createResult.message }
        if (
          !this.options.isCurrentWorkspaceRuntime(input.userId, coordinates.workspaceId, coordinates.workspaceRuntimeId)
        ) {
          createResult.admission.abort()
          return { ok: false, message: 'error.workspace-runtime-stale' }
        }
        return {
          ok: true,
          terminalSessionId: createResult.terminalSessionId,
          admission: createResult.admission,
          terminalRuntimeSessionId: createResult.terminalRuntimeSessionId,
        }
      },
    )
  }
}

export function createTerminalSessionCreator(options: TerminalSessionCreatorOptions): TerminalSessionCreator {
  return new TerminalSessionCreator(options)
}
