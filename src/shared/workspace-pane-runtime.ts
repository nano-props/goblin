import type { TerminalCreateInput, TerminalCreateResult } from '#/shared/terminal-types.ts'
import type { WorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import type { RuntimeWorkspacePaneTarget } from '#/shared/workspace-runtime.ts'

export const WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS = {
  open: 'workspace-pane-runtime.open',
  close: 'workspace-pane-runtime.close',
} as const

export type WorkspacePaneRuntimeSocketAction =
  (typeof WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS)[keyof typeof WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS]

export interface WorkspacePaneRuntimeTabPlacement {
  insertAfterIdentity?: string | null
}

/**
 * Application-level request for opening a server-owned runtime tab.
 *
 * The discriminant is intentionally outside the provider request. Future
 * providers (for example Chat) extend this union while keeping their domain
 * create inputs independent from workspace-pane placement concerns.
 */
export interface TerminalWorkspacePaneRuntimeOpenInput extends WorkspacePaneRuntimeTabPlacement {
  runtimeType: 'terminal'
  request: TerminalCreateInput
}

export type WorkspacePaneRuntimeOpenInput = TerminalWorkspacePaneRuntimeOpenInput

export interface WorkspacePaneRuntimeCommandTarget {
  target: RuntimeWorkspacePaneTarget
  nativeWorktreePath: string
}

export interface WorkspacePaneRuntimeCloseInput {
  runtimeType: WorkspacePaneRuntimeTabType
  sessionId: string
  target: WorkspacePaneRuntimeCommandTarget
}

export type TerminalWorkspacePaneRuntimeOpenResult =
  | {
      ok: true
      runtimeType: 'terminal'
      runtime: Extract<TerminalCreateResult, { ok: true }>
    }
  | {
      ok: false
      runtimeType: 'terminal'
      message: string
    }

export type WorkspacePaneRuntimeOpenResult = TerminalWorkspacePaneRuntimeOpenResult

export interface TerminalWorkspacePaneRuntimeCloseEffect {
  action: 'closed' | 'already-closed'
  terminalSessionId: string
  terminalRuntimeSessionId: string | null
  terminalRuntimeGeneration: number | null
}

interface TerminalWorkspacePaneRuntimeCloseSuccess {
  ok: true
  runtimeType: 'terminal'
  runtime: TerminalWorkspacePaneRuntimeCloseEffect
}

export type WorkspacePaneRuntimeCloseResult =
  | TerminalWorkspacePaneRuntimeCloseSuccess
  | {
      ok: false
      runtimeType: WorkspacePaneRuntimeTabType
      message: string
    }

export interface WorkspacePaneRuntimeSocketRequestInputs {
  'workspace-pane-runtime.open': WorkspacePaneRuntimeOpenInput
  'workspace-pane-runtime.close': WorkspacePaneRuntimeCloseInput
}

export interface WorkspacePaneRuntimeSocketResponseOutputs {
  'workspace-pane-runtime.open': WorkspacePaneRuntimeOpenResult
  'workspace-pane-runtime.close': WorkspacePaneRuntimeCloseResult
}
