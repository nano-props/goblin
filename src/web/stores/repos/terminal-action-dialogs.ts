import { create } from 'zustand'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'

export interface TerminalCloseConfirmPayload {
  readonly repoId: string
  readonly targetIdentity: string
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
  closeStaleDialogs: (activeRepoId: string) => void
}

type TerminalActionDialogsStore = TerminalActionDialogsState & TerminalActionDialogsActions

const INITIAL_STATE: TerminalActionDialogsState = {
  closeConfirm: null,
}

export const useTerminalActionDialogsStore = create<TerminalActionDialogsStore>()((set) => ({
  ...INITIAL_STATE,
  openCloseConfirm: (payload) => set({ closeConfirm: payload }),
  closeCloseConfirm: () => set({ closeConfirm: null }),
  closeStaleDialogs: (activeRepoId) =>
    set((state) => {
      if (!state.closeConfirm) return state
      return state.closeConfirm.repoId === activeRepoId ? state : { closeConfirm: null }
    }),
}))

export function resetTerminalActionDialogsStore(): void {
  useTerminalActionDialogsStore.setState(INITIAL_STATE)
}
