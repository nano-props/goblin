import type { GoblinNativeBridge } from '#/shared/goblin-native-bridge.ts'

export function currentNativeBridge(overrides: Partial<GoblinNativeBridge> = {}): GoblinNativeBridge {
  return {
    invokeIpc: async () => undefined,
    abortIpc: async () => false,
    notifyAppQuitDrained: async () => true,
    onEvent: () => () => {},
    onIntent: () => () => {},
    pathForFile: () => '',
    host: {
      openSettingsWindow: async () => true,
      openExternalUrl: async ({ url }) => ({ ok: true, message: url }),
      openDirectoryDialog: async () => null,
      consumeExternalOpenPaths: async () => [],
    },
    terminal: {
      notifyBell: async () => true,
      sendTestNotification: async () => true,
      setBadge: () => {},
    },
    rotateAccessToken: async () => ({ accessToken: 'test-access-token' }),
    ...overrides,
  }
}
