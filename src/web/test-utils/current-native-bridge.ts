import type { GoblinNativeBridge } from '#/shared/goblin-native-bridge.ts'

export function currentNativeBridge(overrides: Partial<GoblinNativeBridge> = {}): GoblinNativeBridge {
  return {
    invokeIpc: async () => undefined,
    abortIpc: async () => false,
    notifyAppQuitDrained: async () => true,
    onAppQuitting: () => () => {},
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
    getAccessTokenProjection: async () => ({ accessToken: 'test-access-token', activation: 'current' as const }),
    rotateAccessToken: async () => ({ accessToken: 'test-access-token', activation: 'after-restart' as const }),
    ...overrides,
  }
}
