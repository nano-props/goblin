import { createNativeHostSettingsIpcHandlers } from '#/main/native-host-settings-ipc.ts'
import type { NativeHostIpcHandlers } from '#/shared/api-types.ts'
import { readNativeClientWorkspaceState, writeNativeClientWorkspaceState } from '#/main/client-workspace-state.ts'

export function createNativeHostIpcHandlers(): NativeHostIpcHandlers {
  return {
    clientWorkspace: {
      read: async () => await readNativeClientWorkspaceState(),
      write: async (input) => await writeNativeClientWorkspaceState(input),
    },
    ...createNativeHostSettingsIpcHandlers(),
  }
}
