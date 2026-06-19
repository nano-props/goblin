import { createNativeHostSettingsIpcHandlers } from '#/main/native-host-settings-ipc.ts'
import { applyMenuWorkspaceLayout } from '#/main/menu.ts'
import type { NativeIpcHandlers } from '#/shared/api-types.ts'
import type { WorkspaceLayout } from '#/shared/workspace-layout.ts'

export function createNativeHostIpcHandlers(): NativeIpcHandlers {
  return {
    ...createNativeHostSettingsIpcHandlers(),
    session: {
      // Renderer is the authority for `workspaceLayout` once the app is
      // running (it owns the store; main's menu reflects it). Push from
      // the renderer keeps the menu's `view-toggle-detail` `enabled`
      // predicate — and therefore the CmdOrCtrl+J accelerator — in sync
      // with the actual layout after the user toggles via in-app UI.
      setWorkspaceLayout: async (input: { workspaceLayout: WorkspaceLayout }) => {
        return applyMenuWorkspaceLayout(input.workspaceLayout)
      },
    },
  }
}
