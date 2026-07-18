import { create } from 'zustand'

export interface FiletreeTrashFilePayload {
  readonly workspaceId: string
  readonly workspaceRuntimeId: string
  readonly worktreePath: string
  readonly path: string
  readonly name: string
}

interface FiletreeActionDialogsState {
  trashFileConfirm: FiletreeTrashFilePayload | null
}

interface FiletreeActionDialogsActions {
  openTrashFileConfirm: (payload: FiletreeTrashFilePayload) => void
  closeTrashFileConfirm: () => void
  closeStaleDialogs: (currentWorkspaceId: string) => void
}

type FiletreeActionDialogsStore = FiletreeActionDialogsState & FiletreeActionDialogsActions

const INITIAL_STATE: FiletreeActionDialogsState = {
  trashFileConfirm: null,
}

export const useFiletreeActionDialogsStore = create<FiletreeActionDialogsStore>()((set) => ({
  ...INITIAL_STATE,
  openTrashFileConfirm: (payload) => set({ trashFileConfirm: payload }),
  closeTrashFileConfirm: () => set({ trashFileConfirm: null }),
  closeStaleDialogs: (currentWorkspaceId) =>
    set((state) => {
      if (!state.trashFileConfirm) return state
      return state.trashFileConfirm.workspaceId === currentWorkspaceId ? state : { trashFileConfirm: null }
    }),
}))

export function resetFiletreeActionDialogsStore(): void {
  useFiletreeActionDialogsStore.setState(INITIAL_STATE)
}
