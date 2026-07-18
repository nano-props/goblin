import { buildRemoteTerminalInvocation } from '#/system/ssh/commands.ts'
import { isRemoteRepoId } from '#/shared/remote-repo.ts'
import {
  type TerminalCreateAction,
  terminalExecutionCoordinates,
  type TerminalExecutionTarget,
  type TerminalPresentation,
  type TerminalRuntimeMetadata,
} from '#/shared/terminal-types.ts'
import {
  buildGoblinTerminalCommandEnvironment,
  type GoblinTerminalCommandRuntime,
} from '#/server/terminal/g-command.ts'
import {
  physicalWorktreeExecutionBinding,
  type PhysicalWorktreeExecutionCapability,
} from '#/server/worktree-removal/physical-worktree-capability.ts'

export interface TerminalSessionEnsureInput {
  terminalSessionId?: string
  startupShellCommand?: string
  cols?: number
  rows?: number
  clientId?: string
  target: TerminalExecutionTarget
}

export type TerminalSessionEnsureResult =
  | {
      ok: true
      terminalSessionId: string
      terminalRuntimeSessionId: string
      admission: TerminalSessionAdmission
    }
  | { ok: false; message: string }

export type TerminalSessionPrepareManagerResult =
  { ok: true; terminalRuntimeSessionId: string; admission: TerminalSessionAdmission } | { ok: false; message: string }

export type TerminalSessionAdmissionCommitResult = {
  action: TerminalCreateAction
  presentation: TerminalPresentation
  terminalSessionsRevision: number
} & TerminalRuntimeMetadata

export interface TerminalSessionAdmission {
  kind: 'existing' | 'prepared'
  commit(input: { presentation: TerminalPresentation }): TerminalSessionAdmissionCommitResult
  publishCommittedEffects(): void
  abort(): void
}

export interface TerminalSessionEnsureManagerInput {
  userId: string
  terminalSessionId: string
  physicalWorktreeCapability: PhysicalWorktreeExecutionCapability
  cwd: string
  cols: number
  rows: number
  clientId?: string
  command?: string
  args?: string[]
  startupShellCommand?: string
  env?: Record<string, string>
  signal?: AbortSignal
  target: TerminalExecutionTarget
}

export interface TerminalSessionEnsureManager {
  prepareSession(
    input: TerminalSessionEnsureManagerInput,
  ): TerminalSessionPrepareManagerResult | Promise<TerminalSessionPrepareManagerResult>
}

export interface TerminalSessionEnsurerOptions {
  manager: TerminalSessionEnsureManager
  gCommand?: GoblinTerminalCommandRuntime
}

export interface TerminalSessionEnsureContext {
  terminalSessionId: string
  cols: number
  rows: number
  physicalWorktreeCapability: PhysicalWorktreeExecutionCapability
  signal: AbortSignal
}

class TerminalSessionEnsurer {
  private readonly options: TerminalSessionEnsurerOptions

  constructor(options: TerminalSessionEnsurerOptions) {
    this.options = options
  }

  async ensure(
    userId: string,
    input: TerminalSessionEnsureInput,
    context: TerminalSessionEnsureContext,
  ): Promise<TerminalSessionEnsureResult> {
    if (isRemoteRepoId(terminalExecutionCoordinates(input.target).repoRoot)) {
      return await this.ensureRemote(userId, input, context)
    }
    return await this.ensureLocal(userId, input, context)
  }

  private async ensureRemote(
    userId: string,
    input: TerminalSessionEnsureInput,
    context: TerminalSessionEnsureContext,
  ): Promise<TerminalSessionEnsureResult> {
    const execution = physicalWorktreeExecutionBinding(context.physicalWorktreeCapability)
    if (execution.kind !== 'remote') return { ok: false, message: 'error.invalid-worktree-capability' }
    const invocation = buildRemoteTerminalInvocation(
      execution.target,
      execution.canonicalWorktreePath,
      {
        cols: context.cols,
        rows: context.rows,
      },
      { startupShellCommand: input.startupShellCommand },
    )
    const coordinates = terminalExecutionCoordinates(input.target)
    const result = await this.options.manager.prepareSession({
      userId,
      terminalSessionId: context.terminalSessionId,
      physicalWorktreeCapability: context.physicalWorktreeCapability,
      cwd: process.cwd(),
      cols: context.cols,
      rows: context.rows,
      clientId: input.clientId,
      command: invocation.command,
      args: invocation.args,
      signal: context.signal,
      target: input.target,
    })
    if (!result.ok) return { ok: false, message: result.message }
    return toEnsureResult(context.terminalSessionId, result)
  }

  private async ensureLocal(
    userId: string,
    input: TerminalSessionEnsureInput,
    context: TerminalSessionEnsureContext,
  ): Promise<TerminalSessionEnsureResult> {
    const execution = physicalWorktreeExecutionBinding(context.physicalWorktreeCapability)
    if (execution.kind !== 'local') return { ok: false, message: 'error.invalid-worktree-capability' }
    const coordinates = terminalExecutionCoordinates(input.target)
    const repoRoot = coordinates.repoRoot
    const worktreePath = execution.canonicalWorktreePath
    const env = this.options.gCommand
      ? (buildGoblinTerminalCommandEnvironment({
          ...this.options.gCommand,
          repoRoot,
          worktreePath,
        }) ?? undefined)
      : undefined
    const result = await this.options.manager.prepareSession({
      userId,
      terminalSessionId: context.terminalSessionId,
      physicalWorktreeCapability: context.physicalWorktreeCapability,
      cwd: worktreePath,
      cols: context.cols,
      rows: context.rows,
      clientId: input.clientId,
      startupShellCommand: input.startupShellCommand,
      env,
      signal: context.signal,
      target: input.target,
    })
    if (!result.ok) return { ok: false, message: result.message }
    return toEnsureResult(context.terminalSessionId, result)
  }
}

export function createTerminalSessionEnsurer(options: TerminalSessionEnsurerOptions): TerminalSessionEnsurer {
  return new TerminalSessionEnsurer(options)
}

function toEnsureResult(
  terminalSessionId: string,
  prepared: Extract<TerminalSessionPrepareManagerResult, { ok: true }>,
): TerminalSessionEnsureResult {
  return {
    ok: true,
    terminalRuntimeSessionId: prepared.terminalRuntimeSessionId,
    terminalSessionId,
    admission: prepared.admission,
  }
}
