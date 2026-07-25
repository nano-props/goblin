import { create } from 'zustand'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { WorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'

export interface TerminalCloseConfirmPayload {
  readonly workspaceId: WorkspaceId
  readonly targetIdentity: string
  readonly selectedIdentity: string | null
  readonly workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
  readonly routeTarget: WorkspacePaneTabsTarget
  readonly terminalSessionId: string
  readonly terminalBase: TerminalSessionBase
  readonly processName: string
}

interface TerminalActionDialogsState {
  closeConfirm: TerminalCloseConfirmPayload | null
}

interface TerminalActionDialogsActions {
  openCloseConfirm: (payload: TerminalCloseConfirmPayload) => void
  closeCloseConfirm: () => void
  closeStaleDialogs: (currentWorkspaceId: string) => void
}

type TerminalActionDialogsStore = TerminalActionDialogsState & TerminalActionDialogsActions

const INITIAL_STATE: TerminalActionDialogsState = {
  closeConfirm: null,
}

export const useTerminalActionDialogsStore = create<TerminalActionDialogsStore>()((set) => ({
  ...INITIAL_STATE,
  openCloseConfirm: (payload) => set({ closeConfirm: payload }),
  closeCloseConfirm: () => set({ closeConfirm: null }),
  closeStaleDialogs: (currentWorkspaceId) =>
    set((state) => {
      if (!state.closeConfirm) return state
      return state.closeConfirm.workspaceId === currentWorkspaceId ? state : { closeConfirm: null }
    }),
}))

export function resetTerminalActionDialogsStore(): void {
  useTerminalActionDialogsStore.setState(INITIAL_STATE)
}
