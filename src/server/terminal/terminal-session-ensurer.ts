import path from 'node:path'
import { getWorktrees } from '#/system/git/worktrees.ts'
import { resolveKnownWorktree } from '#/shared/worktree-guards.ts'
import { resolveRemoteTarget } from '#/system/ssh/config.ts'
import { buildRemoteTerminalInvocation } from '#/system/ssh/commands.ts'
import { isRemoteRepoId, parseRemoteRepoId } from '#/shared/remote-repo.ts'
import {
  type TerminalAttachResult,
  type TerminalCreateAction,
  type TerminalControllerStatus,
  type TerminalSessionPhase,
} from '#/shared/terminal-types.ts'
import { terminalSessionRuntimeScope } from '#/server/terminal/terminal-session-scope.ts'
import {
  buildGoblinTerminalCommandEnvironment,
  type GoblinTerminalCommandRuntime,
} from '#/server/terminal/g-command.ts'

export interface TerminalSessionEnsureInput {
  repoRoot: string
  repoInstanceId: string
  branch: string
  worktreePath: string
  terminalSessionId?: string
  startupShellCommand?: string
  cols?: number
  rows?: number
  clientId?: string
}

export type TerminalSessionEnsureResult =
  | {
      ok: true
      terminalRuntimeSessionId: string
      terminalSessionId: string
      action: TerminalCreateAction
      processName: string
      canonicalTitle: string | null
      phase: TerminalSessionPhase
      message: string | null
      snapshot: string
      snapshotSeq: number
      outputEra: number
      controller: { clientId: string; status: Exclude<TerminalControllerStatus, 'none'> } | null
      canonicalCols: number
      canonicalRows: number
    }
  | { ok: false; message: string }

export interface TerminalSessionEnsureManagerInput {
  userId: string
  scope: string
  repoRoot: string
  repoInstanceId: string
  branch: string
  terminalSessionId: string
  worktreePath: string
  cwd: string
  cols: number
  rows: number
  clientId?: string
  command?: string
  args?: string[]
  startupShellCommand?: string
  env?: Record<string, string>
}

export interface TerminalSessionEnsureManager {
  ensureSession(input: TerminalSessionEnsureManagerInput): Promise<TerminalAttachResult>
}

export interface TerminalSessionEnsurerOptions {
  manager: TerminalSessionEnsureManager
  broadcastSessionsChanged(userId: string, repoRoot: string): void
  gCommand?: GoblinTerminalCommandRuntime
}

export interface TerminalSessionEnsureContext {
  terminalSessionId: string
  cols: number
  rows: number
  scopedWorktreePath: string
  action: TerminalCreateAction
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
    const ref = parseRemoteRepoId(input.repoRoot)
    if (!ref) return { ok: false, message: 'error.ssh-config-changed' }
    let resolved
    try {
      resolved = await resolveRemoteTarget(ref)
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'error.ssh-config-changed' }
    }
    const invocation = buildRemoteTerminalInvocation(
      resolved.target,
      input.worktreePath,
      {
        cols: context.cols,
        rows: context.rows,
      },
      { startupShellCommand: input.startupShellCommand },
    )
    const result = await this.options.manager.ensureSession({
      userId,
      scope: terminalSessionRuntimeScope(input.repoRoot, input.repoInstanceId),
      repoRoot: input.repoRoot,
      repoInstanceId: input.repoInstanceId,
      branch: input.branch,
      terminalSessionId: context.terminalSessionId,
      worktreePath: context.scopedWorktreePath,
      cwd: process.cwd(),
      cols: context.cols,
      rows: context.rows,
      clientId: input.clientId,
      command: invocation.command,
      args: invocation.args,
    })
    if (!result.ok) return { ok: false, message: result.message }
    this.options.broadcastSessionsChanged(userId, input.repoRoot)
    return toEnsureResult(context.terminalSessionId, context.action, result)
  }

  private async ensureLocal(
    userId: string,
    input: TerminalSessionEnsureInput,
    context: TerminalSessionEnsureContext,
  ): Promise<TerminalSessionEnsureResult> {
    const worktrees = await getWorktrees(input.repoRoot, { includeStatus: false })
    const resolved = resolveKnownWorktree(worktrees, input.worktreePath, input.branch)
    if (!resolved.ok) return { ok: false, message: resolved.message }

    const repoRoot = path.resolve(input.repoRoot)
    const worktreePath = path.resolve(resolved.path)
    const env = this.options.gCommand
      ? (buildGoblinTerminalCommandEnvironment({
          ...this.options.gCommand,
          repoRoot,
          worktreePath,
        }) ?? undefined)
      : undefined
    const result = await this.options.manager.ensureSession({
      userId,
      scope: terminalSessionRuntimeScope(input.repoRoot, input.repoInstanceId),
      repoRoot,
      repoInstanceId: input.repoInstanceId,
      branch: input.branch,
      terminalSessionId: context.terminalSessionId,
      worktreePath: worktreePath,
      cwd: worktreePath,
      cols: context.cols,
      rows: context.rows,
      clientId: input.clientId,
      startupShellCommand: input.startupShellCommand,
      env,
    })
    if (!result.ok) return { ok: false, message: result.message }
    this.options.broadcastSessionsChanged(userId, input.repoRoot)
    return toEnsureResult(context.terminalSessionId, context.action, result)
  }
}

export function createTerminalSessionEnsurer(options: TerminalSessionEnsurerOptions): TerminalSessionEnsurer {
  return new TerminalSessionEnsurer(options)
}

function toEnsureResult(
  terminalSessionId: string,
  action: TerminalCreateAction,
  snapshotResult: Extract<TerminalAttachResult, { ok: true }>,
): TerminalSessionEnsureResult {
  return {
    ok: true,
    terminalRuntimeSessionId: snapshotResult.terminalRuntimeSessionId,
    terminalSessionId,
    action,
    processName: snapshotResult.processName,
    canonicalTitle: snapshotResult.canonicalTitle,
    phase: snapshotResult.phase,
    message: snapshotResult.message,
    snapshot: snapshotResult.snapshot,
    snapshotSeq: snapshotResult.snapshotSeq,
    outputEra: snapshotResult.outputEra,
    controller: snapshotResult.controller,
    canonicalCols: snapshotResult.canonicalCols,
    canonicalRows: snapshotResult.canonicalRows,
  }
}
