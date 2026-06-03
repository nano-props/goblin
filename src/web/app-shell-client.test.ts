import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { RendererBridge } from '#/web/renderer-bridge-types.ts'

function installWindow() {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: {
        href: 'http://127.0.0.1:32100/',
        origin: 'http://127.0.0.1:32100',
        search: '',
      },
      open: vi.fn(() => ({})),
    },
  })
}

function testBridge(overrides: Partial<RendererBridge> = {}): RendererBridge {
  return {
    getBootstrap: () => ({ homeDir: '/Users/test', initialI18n: null, initialSettings: null, initialServer: null }),
    invokeRpc: vi.fn(),
    abortRpc: vi.fn(async () => false),
    onRpcEvent: () => () => {},
    pathForFile: () => '',
    shell: () => null,
    terminal: (() => {
      throw new Error('unused terminal bridge')
    }) as never,
    ...overrides,
  }
}

describe('app shell client', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    installWindow()
  })

  test('opens app settings through the renderer bridge shell', async () => {
    const bridgeModule = await import('#/web/renderer-bridge.ts')
    const openSettingsWindow = vi.fn(async () => true)
    bridgeModule.setRendererBridgeForTests(
      testBridge({
        shell: () => ({
          openSettingsWindow,
          openExternalUrl: vi.fn(),
          openDirectoryDialog: vi.fn(),
          consumeExternalOpenPaths: vi.fn(),
          openInFinder: vi.fn(),
        }),
      }),
    )

    const { openAppSettings } = await import('#/web/app-shell-client.ts')
    await expect(openAppSettings('about')).resolves.toBe(true)
    expect(openSettingsWindow).toHaveBeenCalledWith({ page: 'about' })
  })

  test('opens external URLs in the browser when no native shell is available', async () => {
    const { openExternalUrl } = await import('#/web/app-shell-client.ts')
    await expect(openExternalUrl('https://example.com')).resolves.toEqual({ ok: true, message: 'https://example.com' })
    expect(window.open).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer')
  })

  test('chooses repository paths through the renderer bridge shell', async () => {
    const bridgeModule = await import('#/web/renderer-bridge.ts')
    const openDirectoryDialog = vi.fn(async (input?: { title?: string }) =>
      input?.title === 'Open Git Repository' ? '/tmp/repo' : '/tmp',
    )
    bridgeModule.setRendererBridgeForTests(
      testBridge({
        shell: () => ({
          openSettingsWindow: vi.fn(),
          openExternalUrl: vi.fn(),
          openDirectoryDialog,
          consumeExternalOpenPaths: vi.fn(),
          openInFinder: vi.fn(),
        }),
      }),
    )

    const { chooseCloneParentPath, chooseLocalRepositoryPath, hasNativeDirectoryPicker } =
      await import('#/web/app-shell-client.ts')
    expect(hasNativeDirectoryPicker()).toBe(true)
    await expect(chooseLocalRepositoryPath()).resolves.toBe('/tmp/repo')
    await expect(chooseCloneParentPath()).resolves.toBe('/tmp')
  })
})
