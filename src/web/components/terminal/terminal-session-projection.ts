import { resolveTerminalController } from '#/shared/terminal-controller.ts'
import {
  terminalExecutionCoordinates,
  terminalSessionCoordinates,
  type TerminalPresentation,
  type TerminalExecutionTarget,
  type TerminalAttachResult,
  type TerminalCreateResult,
  type TerminalSessionBase,
  type TerminalSessionSummary as ServerTerminalSessionSummary,
} from '#/shared/terminal-types.ts'
import { terminalDescriptor } from '#/web/components/terminal/terminal-descriptor.ts'
import { formatTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'
import type {
  TerminalDescriptor,
  TerminalSessionHydrationInput,
  TerminalIdentityViewModel,
} from '#/web/components/terminal/types.ts'

export type TerminalAttachResultWithController = Extract<TerminalAttachResult, { ok: true }> & {
  role: TerminalIdentityViewModel['role']
  controllerStatus: TerminalIdentityViewModel['controllerStatus']
}

export interface ProjectedServerTerminalSession {
  descriptor: TerminalDescriptor
  terminalWorktreeKey: string
  hydrateInput: TerminalSessionHydrationInput
  controlsTerminal: boolean
}

export interface ProjectedCreateTerminalSession {
  serverSession: ServerTerminalSessionSummary
}

export function projectTerminalAttachResultForClient(
  result: Extract<TerminalAttachResult, { ok: true }>,
  clientId: string,
): TerminalAttachResultWithController {
  return {
    ...result,
    ...resolveTerminalController(result.controller, clientId),
  }
}

export function projectCreateResultForClient(
  base: TerminalSessionBase,
  result: Extract<TerminalCreateResult, { ok: true }>,
): ProjectedCreateTerminalSession {
  const target = base.target
  if (target.kind !== result.presentation.kind) {
    throw new Error('terminal create result does not match its execution target')
  }
  return {
    serverSession: createSessionSummaryFromCreate(base, result),
  }
}

export function projectServerTerminalSession(input: {
  repoRoot: string
  repoRuntimeId: string
  serverSession: ServerTerminalSessionSummary
  clientId: string
  index: number
}): ProjectedServerTerminalSession | null {
  const coordinates = terminalExecutionCoordinates(input.serverSession.target)
  if (coordinates.repoRoot !== input.repoRoot) return null
  if (coordinates.repoRuntimeId !== input.repoRuntimeId) return null
  const descriptor = terminalDescriptor(
    terminalSessionBase(input.serverSession.target, input.serverSession.presentation),
    input.serverSession.terminalSessionId,
    input.index,
  )
  const terminalWorktree = formatTerminalWorktreeKey(coordinates.repoRoot, coordinates.worktreeId)
  const controller = resolveTerminalController(input.serverSession.controller, input.clientId)
  return {
    descriptor,
    terminalWorktreeKey: terminalWorktree,
    hydrateInput: {
      terminalRuntimeSessionId: input.serverSession.terminalRuntimeSessionId,
      terminalRuntimeGeneration: input.serverSession.terminalRuntimeGeneration,
      processName: input.serverSession.processName,
      canonicalTitle: input.serverSession.canonicalTitle,
      phase: input.serverSession.phase,
      message: input.serverSession.message,
      role: controller.role,
      controllerStatus: controller.controllerStatus,
      canonicalCols: input.serverSession.cols,
      canonicalRows: input.serverSession.rows,
      snapshot: null,
      snapshotSeq: 0,
      outputEra: 0,
    },
    controlsTerminal: input.serverSession.controller?.clientId === input.clientId,
  }
}

function createSessionSummaryFromCreate(
  base: TerminalSessionBase,
  result: Extract<TerminalCreateResult, { ok: true }>,
): ServerTerminalSessionSummary {
  const coordinates = terminalSessionCoordinates(base)
  const common = {
    terminalRuntimeSessionId: result.terminalRuntimeSessionId,
    terminalRuntimeGeneration: result.terminalRuntimeGeneration,
    terminalSessionId: result.terminalSessionId,
    controller: result.controller,
    processName: result.processName,
    canonicalTitle: result.canonicalTitle,
    phase: result.phase,
    message: result.message,
    cols: result.canonicalCols,
    rows: result.canonicalRows,
  }
  const target = base.target
  if (target.kind === 'workspace-root' && result.presentation.kind === 'workspace-root') {
    return { ...common, target, presentation: result.presentation }
  }
  if (target.kind === 'git-worktree' && result.presentation.kind === 'git-worktree') {
    return { ...common, target, presentation: result.presentation }
  }
  throw new Error('terminal create target and presentation disagree')
}

function terminalSessionBase(target: TerminalExecutionTarget, presentation: TerminalPresentation): TerminalSessionBase {
  if (target.kind === 'workspace-root' && presentation.kind === 'workspace-root') return { target, presentation }
  if (target.kind === 'git-worktree' && presentation.kind === 'git-worktree') return { target, presentation }
  throw new Error('terminal target and presentation disagree')
}
