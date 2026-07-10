import type { TerminalCreateInput, TerminalCreateResult } from '#/shared/terminal-types.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'

export const WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS = {
  open: 'workspace-pane-runtime.open',
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

export type TerminalWorkspacePaneRuntimeOpenResult =
  | {
      ok: true
      runtimeType: 'terminal'
      runtime: Extract<TerminalCreateResult, { ok: true }>
      tabs: WorkspacePaneTabEntry[]
    }
  | {
      ok: false
      runtimeType: 'terminal'
      message: string
    }

export type WorkspacePaneRuntimeOpenResult = TerminalWorkspacePaneRuntimeOpenResult

export interface WorkspacePaneRuntimeSocketRequestInputs {
  'workspace-pane-runtime.open': WorkspacePaneRuntimeOpenInput
}

export interface WorkspacePaneRuntimeSocketResponseOutputs {
  'workspace-pane-runtime.open': WorkspacePaneRuntimeOpenResult
}
