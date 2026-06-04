import { app } from 'electron'
import { createSettingsNativeRpcHandlers } from '#/main/settings-native-rpc.ts'
import type { NativeRpcHandlers } from '#/shared/rpc.ts'

export function createNativeRpcHandlers(): Pick<NativeRpcHandlers, 'settings'> {
  return {
    ...createSettingsNativeRpcHandlers({
      addRecentDocument: (path) => app.addRecentDocument(path),
    }),
  }
}
