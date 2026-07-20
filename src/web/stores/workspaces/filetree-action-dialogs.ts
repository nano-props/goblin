import { create } from 'zustand'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { WorkspacePaneFilesystemExecutionTarget } from '#/shared/workspace-runtime.ts'

export interface FiletreeTrashFilePayload {
  readonly target: WorkspacePaneFilesystemExecutionTarget
  readonly path: string
  readonly name: string
}

interface FiletreeActionDialogsState {
  trashFileConfirm: FiletreeTrashFilePayload | null
}

interface FiletreeActionDialogsActions {
  openTrashFileConfirm: (payload: FiletreeTrashFilePayload) => void
  closeTrashFileConfirm: () => void
  closeStaleDialogs: (currentRuntime: { workspaceId: WorkspaceId; workspaceRuntimeId: string } | null) => void
}

type FiletreeActionDialogsStore = FiletreeActionDialogsState & FiletreeActionDialogsActions

const INITIAL_STATE: FiletreeActionDialogsState = {
  trashFileConfirm: null,
}

export const useFiletreeActionDialogsStore = create<FiletreeActionDialogsStore>()((set) => ({
  ...INITIAL_STATE,
  openTrashFileConfirm: (payload) => set({ trashFileConfirm: payload }),
  closeTrashFileConfirm: () => set({ trashFileConfirm: null }),
  closeStaleDialogs: (currentRuntime) =>
    set((state) => {
      if (!state.trashFileConfirm) return state
      const target = state.trashFileConfirm.target
      return target.workspaceId === currentRuntime?.workspaceId &&
        target.workspaceRuntimeId === currentRuntime.workspaceRuntimeId
        ? state
        : { trashFileConfirm: null }
    }),
}))

export function resetFiletreeActionDialogsStore(): void {
  useFiletreeActionDialogsStore.setState(INITIAL_STATE)
}
