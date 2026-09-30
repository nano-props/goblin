import { stubBrowserGlobal } from '#/web/test-utils/browser-globals.ts'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ClientBridge } from '#/web/bridge/types.ts'

function installWindow(openReturn: unknown = {}) {
  stubBrowserGlobal('window', {
    location: {
      href: 'http://127.0.0.1:32100/',
      origin: 'http://127.0.0.1:32100',
      search: '',
    },
    open: vi.fn(() => openReturn),
  })
}

function testBridge(overrides: Partial<ClientBridge> = {}): ClientBridge {
  return {
    getBootstrap: () => ({
      initialServer: null,
    }),

    saveClipboardFiles: () => Promise.resolve([]),

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

  test('opens external URLs in the browser', async () => {
    const { openExternalUrl } = await import('#/web/app/shell-client.ts')
    await expect(openExternalUrl('https://example.com')).resolves.toEqual({ ok: true, message: 'https://example.com' })
    expect(window.open).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer')
  })

  test('still reports success when window.open returns null under noopener', async () => {
    // window.open() with `noopener` returns null by spec even when the new
    // tab opens — that is the entire point of noopener (reverse-tabnabbing
    // protection). The client cannot observe the outcome, so the URL
    // handoff is treated as best-effort success.
    installWindow(null)
    const { openExternalUrl } = await import('#/web/app/shell-client.ts')
    await expect(openExternalUrl('https://example.com')).resolves.toEqual({ ok: true, message: 'https://example.com' })
    expect(window.open).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer')
  })

  test('saveClipboardFiles forwards paths from the bridge', async () => {
    const bridgeModule = await import('#/web/bridge/client.ts')
    bridgeModule.setClientBridgeForTests(testBridge({ saveClipboardFiles: vi.fn(async () => ['/tmp/a', '/tmp/b']) }))
    const { saveClipboardFiles } = await import('#/web/app/shell-client.ts')
    const files = [new File([new Uint8Array([1])], 'a'), new File([new Uint8Array([2])], 'b')]
    await expect(saveClipboardFiles(files)).resolves.toEqual(['/tmp/a', '/tmp/b'])
  })

  test('saveClipboardFiles propagates a synchronous bridge failure', async () => {
    const bridgeModule = await import('#/web/bridge/client.ts')
    bridgeModule.setClientBridgeForTests(
      testBridge({
        saveClipboardFiles: vi.fn(() => {
          throw new Error('bridge unavailable')
        }),
      }),
    )
    const { saveClipboardFiles } = await import('#/web/app/shell-client.ts')
    await expect(saveClipboardFiles([new File([new Uint8Array([1])], 'a')])).rejects.toThrow('bridge unavailable')
  })

  test('saveClipboardFiles propagates an asynchronous bridge failure', async () => {
    const bridgeModule = await import('#/web/bridge/client.ts')
    bridgeModule.setClientBridgeForTests(
      testBridge({
        saveClipboardFiles: vi.fn(async () => {
          throw new Error('async bridge failure')
        }),
      }),
    )
    const { saveClipboardFiles } = await import('#/web/app/shell-client.ts')
    await expect(saveClipboardFiles([new File([new Uint8Array([1])], 'a')])).rejects.toThrow('async bridge failure')
  })
})
