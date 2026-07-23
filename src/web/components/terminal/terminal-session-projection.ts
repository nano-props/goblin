import { resolveTerminalController } from '#/shared/terminal-controller.ts'
import {
  terminalExecutionCoordinates,
  terminalSessionBase,
  terminalSessionCoordinates,
  type TerminalAttachResult,
  type TerminalCreateResult,
  type TerminalRestartResult,
  type TerminalSessionBase,
  type TerminalSessionSummary as ServerTerminalSessionSummary,
} from '#/shared/terminal-types.ts'
import { terminalDescriptor } from '#/web/components/terminal/terminal-descriptor.ts'
import { formatTerminalFilesystemTargetKey } from '#/shared/terminal-filesystem-target-key.ts'
import type {
  TerminalDescriptor,
  TerminalSessionHydrationInput,
  TerminalIdentityViewModel,
} from '#/web/components/terminal/types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

type TerminalStartResult = Extract<TerminalAttachResult | TerminalRestartResult, { ok: true }>

export type TerminalStartResultWithController = TerminalStartResult & {
  role: TerminalIdentityViewModel['role']
  controllerStatus: TerminalIdentityViewModel['controllerStatus']
}

export interface ProjectedServerTerminalSession {
  descriptor: TerminalDescriptor
  terminalFilesystemTargetKey: string
  hydrateInput: TerminalSessionHydrationInput
  controlsTerminal: boolean
}

export interface ProjectedCreateTerminalSession {
  serverSession: ServerTerminalSessionSummary
}

export function projectTerminalStartResultForClient(
  result: TerminalStartResult,
  clientId: string,
): TerminalStartResultWithController {
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
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
  serverSession: ServerTerminalSessionSummary
  clientId: string
  index: number
}): ProjectedServerTerminalSession | null {
  const coordinates = terminalExecutionCoordinates(input.serverSession.target)
  if (coordinates.workspaceId !== input.workspaceId) return null
  if (coordinates.workspaceRuntimeId !== input.workspaceRuntimeId) return null
  const descriptor = terminalDescriptor(
    terminalSessionBase(input.serverSession.target, input.serverSession.presentation),
    input.serverSession.terminalSessionId,
    input.index,
  )
  const terminalFilesystemTarget = formatTerminalFilesystemTargetKey(
    coordinates.workspaceId,
    coordinates.executionRootId,
  )
  const controller = resolveTerminalController(input.serverSession.controller, input.clientId)
  return {
    descriptor,
    terminalFilesystemTargetKey: terminalFilesystemTarget,
    hydrateInput: {
      terminalRuntimeSessionId: input.serverSession.terminalRuntimeSessionId,
      terminalRuntimeGeneration: input.serverSession.terminalRuntimeGeneration,
      processName: input.serverSession.processName,
      canonicalTitle: input.serverSession.canonicalTitle,
      phase: input.serverSession.phase,
      message: input.serverSession.message,
      role: controller.role,
      controllerStatus: controller.controllerStatus,
      canonicalSize: input.serverSession.canonicalSize,
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
    canonicalSize: result.canonicalSize,
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
