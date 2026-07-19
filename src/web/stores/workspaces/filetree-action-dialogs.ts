import { create } from 'zustand'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

export interface FiletreeTrashFilePayload {
  readonly workspaceId: WorkspaceId
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
  closeStaleDialogs: (currentWorkspaceId: WorkspaceId | null) => void
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
