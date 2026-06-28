import { create } from 'zustand'

export interface FiletreeTrashFilePayload {
  readonly repoId: string
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
  closeStaleDialogs: (activeRepoId: string) => void
}

type FiletreeActionDialogsStore = FiletreeActionDialogsState & FiletreeActionDialogsActions

const INITIAL_STATE: FiletreeActionDialogsState = {
  trashFileConfirm: null,
}

export const useFiletreeActionDialogsStore = create<FiletreeActionDialogsStore>()((set) => ({
  ...INITIAL_STATE,
  openTrashFileConfirm: (payload) => set({ trashFileConfirm: payload }),
  closeTrashFileConfirm: () => set({ trashFileConfirm: null }),
  closeStaleDialogs: (activeRepoId) =>
    set((state) => {
      if (!state.trashFileConfirm) return state
      return state.trashFileConfirm.repoId === activeRepoId ? state : { trashFileConfirm: null }
    }),
}))

export function resetFiletreeActionDialogsStore(): void {
  useFiletreeActionDialogsStore.setState(INITIAL_STATE)
}
