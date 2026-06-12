import { createNativeHostSettingsIpcHandlers } from '#/main/native-host-settings-ipc.ts'
import type { NativeIpcHandlers } from '#/shared/api-types.ts'

export function createNativeHostIpcHandlers(): Pick<NativeIpcHandlers, 'settings'> {
  return {
    ...createNativeHostSettingsIpcHandlers(),
  }
}
