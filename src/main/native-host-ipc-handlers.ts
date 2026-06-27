import { createNativeHostSettingsIpcHandlers } from '#/main/native-host-settings-ipc.ts'
import type { NativeHostIpcHandlers } from '#/shared/api-types.ts'

export function createNativeHostIpcHandlers(): NativeHostIpcHandlers {
  return {
    ...createNativeHostSettingsIpcHandlers(),
  }
}
