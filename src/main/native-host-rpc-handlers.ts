import { app } from 'electron'
import { createNativeHostSettingsRpcHandlers } from '#/main/native-host-settings-rpc.ts'
import type { NativeRpcHandlers } from '#/shared/rpc.ts'

export function createNativeHostRpcHandlers(): Pick<NativeRpcHandlers, 'settings'> {
  return {
    ...createNativeHostSettingsRpcHandlers({
      addRecentDocument: (path) => app.addRecentDocument(path),
    }),
  }
}
