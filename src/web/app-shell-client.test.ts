import { beforeEach, describe, expect, test, vi } from 'vitest'
import { CLIENT_BRIDGE_VERSION } from '#/shared/bootstrap.ts'
import type { ClientBridge } from '#/web/client-bridge-types.ts'

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

function testBridge(overrides: Partial<ClientBridge> = {}): ClientBridge {
  const nativeHost = overrides.host?.() ?? null
  return {
    kind: () => 'web',
    hasCapability: (capability) => {
      if (capability === 'global-shortcut') return typeof overrides.invokeIpc === 'function'
      if (capability === 'open-settings-window') return nativeHost?.openSettingsWindow !== undefined
      if (capability === 'open-external-url') return nativeHost?.openExternalUrl !== undefined
      if (capability === 'open-directory-dialog') return nativeHost?.openDirectoryDialog !== undefined
      if (capability === 'consume-external-open-paths') return nativeHost?.consumeExternalOpenPaths !== undefined
      return false
    },
    getBootstrap: () => ({
      runtime: { kind: 'web', bridgeVersion: CLIENT_BRIDGE_VERSION, capabilities: [] },
      initialServer: null,
    }),
    invokeIpc: vi.fn(),
    abortIpc: vi.fn(async () => false),
    onIpcEvent: () => () => {},
    onEffectIntent: () => () => {},
    pathForFile: () => '',
    saveClipboardFiles: () => Promise.resolve([]),
    host: () => null,
    appRealtime: () => ({
      kickReconnect: () => {},
      onRecovered: () => () => {},
    }),
    terminal: (() => {
      throw new Error('unused terminal client')
    }) as never,
    workspacePaneTabs: (() => {
      throw new Error('unused workspace pane tabs client')
    }) as never,
    workspacePaneRuntime: (() => {
      throw new Error('unused workspace pane runtime client')
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

  test('opens app settings through the client bridge host', async () => {
    const bridgeModule = await import('#/web/client-bridge.ts')
    const openSettingsWindow = vi.fn(async () => true)
    bridgeModule.setClientBridgeForTests(
      testBridge({
        kind: () => 'electron',
        host: () => ({
          openSettingsWindow,
          openExternalUrl: vi.fn(),
          openDirectoryDialog: vi.fn(),
          consumeExternalOpenPaths: vi.fn(),
        }),
      }),
    )

    const { openAppSettings } = await import('#/web/app-shell-client.ts')
    await expect(openAppSettings('about')).resolves.toBe(true)
    expect(openSettingsWindow).toHaveBeenCalledWith({ page: 'about' })
  })

  test('opens external URLs in the browser when no native host is available', async () => {
    const { openExternalUrl } = await import('#/web/app-shell-client.ts')
    await expect(openExternalUrl('https://example.com')).resolves.toEqual({ ok: true, message: 'https://example.com' })
    expect(window.open).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer')
  })

  test('still reports success when window.open returns null under noopener', async () => {
    // window.open() with `noopener` returns null by spec even when the new
    // tab opens — that is the entire point of noopener (reverse-tabnabbing
    // protection). The client cannot observe the outcome, so the URL
    // handoff is treated as best-effort success.
    installWindow(null)
    const { openExternalUrl } = await import('#/web/app-shell-client.ts')
    await expect(openExternalUrl('https://example.com')).resolves.toEqual({ ok: true, message: 'https://example.com' })
    expect(window.open).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer')
  })

  test('opens the project GitHub URL through the native host with https-only policy', async () => {
    const bridgeModule = await import('#/web/client-bridge.ts')
    const hostOpenExternalUrl = vi.fn(async () => ({ ok: true, message: 'https://github.com/nano-props/goblin' }))
    bridgeModule.setClientBridgeForTests(
      testBridge({
        kind: () => 'electron',
        host: () => ({
          openSettingsWindow: vi.fn(),
          openExternalUrl: hostOpenExternalUrl,
          openDirectoryDialog: vi.fn(),
          consumeExternalOpenPaths: vi.fn(),
        }),
      }),
    )

    const { openProjectGitHub } = await import('#/web/app-shell-client.ts')
    await expect(openProjectGitHub()).resolves.toEqual({ ok: true, message: 'https://github.com/nano-props/goblin' })
    expect(hostOpenExternalUrl).toHaveBeenCalledWith({
      url: 'https://github.com/nano-props/goblin',
      allowHttp: false,
    })
    expect(window.open).not.toHaveBeenCalled()
  })

  test('chooses workspace paths through the client bridge host', async () => {
    const bridgeModule = await import('#/web/client-bridge.ts')
    const openDirectoryDialog = vi.fn(async (input?: { title?: string }) =>
      input?.title === 'Open Workspace' ? '/tmp/repo' : '/tmp',
    )
    bridgeModule.setClientBridgeForTests(
      testBridge({
        host: () => ({
          openSettingsWindow: vi.fn(),
          openExternalUrl: vi.fn(),
          openDirectoryDialog,
          consumeExternalOpenPaths: vi.fn(),
        }),
      }),
    )

    const { chooseCloneParentPath, chooseLocalWorkspacePath, hasNativeDirectoryPicker } =
      await import('#/web/app-shell-client.ts')
    expect(hasNativeDirectoryPicker()).toBe(true)
    await expect(chooseLocalWorkspacePath()).resolves.toBe('/tmp/repo')
    await expect(chooseCloneParentPath()).resolves.toBe('/tmp')
  })

  test('saveClipboardFiles forwards paths from the bridge', async () => {
    // Happy path — the resolver relies on the wrapper passing the
    // bridge's response through unchanged so a multi-file paste can
    // hit the paste-file-partial branch when only some files made
    // it across. Without this test, that contract relied on
    // coincidence.
    const bridgeModule = await import('#/web/client-bridge.ts')
    bridgeModule.setClientBridgeForTests(testBridge({ saveClipboardFiles: vi.fn(async () => ['/tmp/a', '/tmp/b']) }))
    const { saveClipboardFiles } = await import('#/web/app-shell-client.ts')
    await expect(saveClipboardFiles([new File([new Uint8Array([1])], 'a')])).resolves.toEqual(['/tmp/a', '/tmp/b'])
  })

  test('saveClipboardFiles propagates a synchronous bridge failure', async () => {
    const bridgeModule = await import('#/web/client-bridge.ts')
    bridgeModule.setClientBridgeForTests(
      testBridge({
        saveClipboardFiles: vi.fn(() => {
          throw new Error('bridge unavailable')
        }),
      }),
    )
    const { saveClipboardFiles } = await import('#/web/app-shell-client.ts')
    await expect(saveClipboardFiles([new File([new Uint8Array([1])], 'a')])).rejects.toThrow('bridge unavailable')
  })

  test('saveClipboardFiles propagates an asynchronous bridge failure', async () => {
    const bridgeModule = await import('#/web/client-bridge.ts')
    bridgeModule.setClientBridgeForTests(
      testBridge({
        saveClipboardFiles: vi.fn(async () => {
          throw new Error('async bridge failure')
        }),
      }),
    )
    const { saveClipboardFiles } = await import('#/web/app-shell-client.ts')
    await expect(saveClipboardFiles([new File([new Uint8Array([1])], 'a')])).rejects.toThrow('async bridge failure')
  })
})
