import type { ClientWorkspaceState, ServerWorkspaceState } from '#/shared/api-types.ts'
import { defaultClientWorkspaceState, defaultServerWorkspaceState } from '#/shared/settings-defaults.ts'

export type TestWorkspaceSessionState = ClientWorkspaceState & ServerWorkspaceState

export function defaultTestWorkspaceSessionState(): TestWorkspaceSessionState {
  return {
    ...defaultServerWorkspaceState(),
    ...defaultClientWorkspaceState(),
  }
}
