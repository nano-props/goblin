import { buildRemoteTerminalInvocation } from '#/system/ssh/commands.ts'
import { isRemoteRepoId } from '#/shared/remote-repo.ts'
import { type TerminalCreateAction, type TerminalRuntimeMetadata } from '#/shared/terminal-types.ts'
import { terminalSessionRuntimeScope } from '#/server/terminal/terminal-session-scope.ts'
import {
  buildGoblinTerminalCommandEnvironment,
  type GoblinTerminalCommandRuntime,
} from '#/server/terminal/g-command.ts'
import {
  physicalWorktreeExecutionBinding,
  type PhysicalWorktreeExecutionCapability,
} from '#/server/worktree-removal/physical-worktree-identity-resolver.ts'
import type { RuntimeWorkspacePaneTarget } from '#/shared/workspace-runtime.ts'

export interface TerminalSessionEnsureInput {
  repoRoot: string
  repoRuntimeId: string
  branch: string
  worktreePath: string
  terminalSessionId?: string
  startupShellCommand?: string
  cols?: number
  rows?: number
  clientId?: string
  target: RuntimeWorkspacePaneTarget
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
  branch: string
  terminalSessionsRevision: number
} & TerminalRuntimeMetadata

export interface TerminalSessionAdmission {
  kind: 'existing' | 'prepared'
  commit(input: { canonicalBranch: string }): TerminalSessionAdmissionCommitResult
  publishCommittedEffects(): void
  abort(): void
}

export interface TerminalSessionEnsureManagerInput {
  userId: string
  scope: string
  repoRoot: string
  repoRuntimeId: string
  branch: string
  terminalSessionId: string
  worktreePath: string
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
  target: RuntimeWorkspacePaneTarget
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
  scopedWorktreePath: string
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
    if (isRemoteRepoId(input.repoRoot)) return await this.ensureRemote(userId, input, context)
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
    const result = await this.options.manager.prepareSession({
      userId,
      scope: terminalSessionRuntimeScope(input.repoRoot, input.repoRuntimeId),
      repoRoot: input.repoRoot,
      repoRuntimeId: input.repoRuntimeId,
      branch: input.branch,
      terminalSessionId: context.terminalSessionId,
      worktreePath: input.worktreePath,
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
    const repoRoot = input.repoRoot
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
      scope: terminalSessionRuntimeScope(input.repoRoot, input.repoRuntimeId),
      repoRoot,
      repoRuntimeId: input.repoRuntimeId,
      branch: input.branch,
      terminalSessionId: context.terminalSessionId,
      worktreePath: input.worktreePath,
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
