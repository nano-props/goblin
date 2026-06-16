import { beforeEach, describe, expect, test, vi } from 'vitest'
import { RENDERER_BRIDGE_VERSION } from '#/shared/bootstrap.ts'
import type { RendererBridge } from '#/web/renderer-bridge-types.ts'

function installWindow(openReturn: unknown = {}) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: {
        href: 'http://127.0.0.1:32100/',
        origin: 'http://127.0.0.1:32100',
        search: '',
      },
      open: vi.fn(() => openReturn),
    },
  })
}

function testBridge(overrides: Partial<RendererBridge> = {}): RendererBridge {
  const nativeShell = overrides.shell?.() ?? null
  return {
    kind: () => 'web',
    hasCapability: (capability) => {
      if (capability === 'settings-ipc') return typeof overrides.invokeIpc === 'function'
      if (capability === 'open-settings-window') return nativeShell?.openSettingsWindow !== undefined
      if (capability === 'open-external-url') return nativeShell?.openExternalUrl !== undefined
      if (capability === 'open-directory-dialog') return nativeShell?.openDirectoryDialog !== undefined
      if (capability === 'consume-external-open-paths') return nativeShell?.consumeExternalOpenPaths !== undefined
      if (capability === 'open-in-finder') return nativeShell?.openInFinder !== undefined
      return false
    },
    getBootstrap: () => ({
      runtime: { kind: 'web', bridgeVersion: RENDERER_BRIDGE_VERSION, capabilities: [] },
      homeDir: '/Users/test',
      platform: 'web',
      initialI18n: null,
      initialSettings: null,
      initialServer: null,
    }),
    invokeIpc: vi.fn(),
    abortIpc: vi.fn(async () => false),
    onIpcEvent: () => () => {},
    onEffectIntent: () => () => {},
    pathForFile: () => '',
    saveClipboardFiles: () => Promise.resolve([]),
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

  test('still reports success when window.open returns null under noopener', async () => {
    // window.open() with `noopener` returns null by spec even when the new
    // tab opens — that is the entire point of noopener (reverse-tabnabbing
    // protection). The renderer cannot observe the outcome, so the URL
    // handoff is treated as best-effort success.
    installWindow(null)
    const { openExternalUrl } = await import('#/web/app-shell-client.ts')
    await expect(openExternalUrl('https://example.com')).resolves.toEqual({ ok: true, message: 'https://example.com' })
    expect(window.open).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer')
  })

  test('opens the project GitHub URL through the native shell with https-only policy', async () => {
    const bridgeModule = await import('#/web/renderer-bridge.ts')
    const shellOpenExternalUrl = vi.fn(async () => ({ ok: true, message: 'https://github.com/nano-props/goblin' }))
    bridgeModule.setRendererBridgeForTests(
      testBridge({
        shell: () => ({
          openSettingsWindow: vi.fn(),
          openExternalUrl: shellOpenExternalUrl,
          openDirectoryDialog: vi.fn(),
          consumeExternalOpenPaths: vi.fn(),
          openInFinder: vi.fn(),
        }),
      }),
    )

    const { openProjectGitHub } = await import('#/web/app-shell-client.ts')
    await expect(openProjectGitHub()).resolves.toEqual({ ok: true, message: 'https://github.com/nano-props/goblin' })
    expect(shellOpenExternalUrl).toHaveBeenCalledWith({
      url: 'https://github.com/nano-props/goblin',
      allowHttp: false,
    })
    expect(window.open).not.toHaveBeenCalled()
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
