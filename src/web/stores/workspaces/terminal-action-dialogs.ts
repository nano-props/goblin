import { createStore } from 'zustand/vanilla'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { WorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import type { WorkspacePaneTabClosePresentationEffects } from '#/web/workspace-pane/workspace-pane-tab-close-presentation.ts'

export interface TerminalCloseConfirmPayload {
  readonly workspaceId: WorkspaceId
  readonly targetIdentity: string
  readonly selectedIdentity: string | null
  readonly workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
  readonly routeTarget: WorkspacePaneTabsTarget
  readonly terminalSessionId: string
  readonly terminalBase: TerminalSessionBase
  readonly processName: string
  readonly presentationEffects?: WorkspacePaneTabClosePresentationEffects
}

interface TerminalActionDialogsState {
  closeConfirm: TerminalCloseConfirmPayload | null
}

interface TerminalActionDialogsActions {
  openCloseConfirm: (payload: TerminalCloseConfirmPayload) => void
  closeCloseConfirm: () => void
  takeCloseConfirm: () => TerminalCloseConfirmPayload | null
  closeStaleDialogs: (currentWorkspaceId: string) => void
}

type TerminalActionDialogsStore = TerminalActionDialogsState & TerminalActionDialogsActions

const INITIAL_STATE: TerminalActionDialogsState = {
  closeConfirm: null,
}

export const terminalActionDialogsStore = createStore<TerminalActionDialogsStore>()((set, get) => ({
  ...INITIAL_STATE,
  openCloseConfirm: (payload) => {
    const previous = get().closeConfirm
    set({ closeConfirm: payload })
    previous?.presentationEffects?.onAbandon()
  },
  closeCloseConfirm: () => {
    const current = get().closeConfirm
    if (!current) return
    set({ closeConfirm: null })
    current.presentationEffects?.onAbandon()
  },
  takeCloseConfirm: () => {
    const current = get().closeConfirm
    if (!current) return null
    set({ closeConfirm: null })
    return current
  },
  closeStaleDialogs: (currentWorkspaceId) => {
    const current = get().closeConfirm
    if (!current || current.workspaceId === currentWorkspaceId) return
    set({ closeConfirm: null })
    current.presentationEffects?.onAbandon()
  },
}))

export function resetTerminalActionDialogsStore(): void {
  const current = terminalActionDialogsStore.getState().closeConfirm
  terminalActionDialogsStore.setState(INITIAL_STATE)
  current?.presentationEffects?.onAbandon()
}
