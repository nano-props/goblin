import { describe, expect, test, vi } from 'vitest'
import {
  isTrustedAppUrl,
  isTrustedIpcEvent,
  registerTrustedAppPath,
  registerTrustedAppUrl,
  registerTrustedWebContents,
} from '#/main/ipc/trusted-webcontents.ts'

describe('trusted app web contents', () => {
  test('does not trust arbitrary file URLs that only share the renderer suffix', () => {
    expect(isTrustedAppUrl('file:///tmp/dist/renderer/index.html')).toBe(false)
  })

  test('does not trust an app URL from an unregistered webContents id', () => {
    registerTrustedAppPath('/app/dist/renderer/index.html')
    registerTrustedWebContents({ id: 1, once: vi.fn() } as any)

    expect(
      isTrustedIpcEvent({
        sender: { id: 99 },
        senderFrame: { url: 'file:///app/dist/renderer/index.html?theme=light' },
      } as any),
    ).toBe(false)
  })

  test('trusts registered webContents only on the registered app file path', () => {
    registerTrustedAppPath('/app/dist/renderer/index.html')
    registerTrustedWebContents({ id: 7, once: vi.fn() } as any)

    expect(
      isTrustedIpcEvent({
        sender: { id: 7 },
        senderFrame: { url: 'file:///app/dist/renderer/index.html?theme=light' },
      } as any),
    ).toBe(true)
    expect(
      isTrustedIpcEvent({
        sender: { id: 7 },
        senderFrame: { url: 'file:///tmp/dist/renderer/index.html?theme=light' },
      } as any),
    ).toBe(false)
  })

  test('trusts the registered dev server app URL but not other routes', () => {
    registerTrustedAppUrl('http://127.0.0.1:5173/')
    registerTrustedWebContents({ id: 8, once: vi.fn() } as any)

    expect(isTrustedAppUrl('http://127.0.0.1:5173/?theme=light')).toBe(true)
    expect(isTrustedAppUrl('http://127.0.0.1:5173/settings')).toBe(false)
    expect(
      isTrustedIpcEvent({
        sender: { id: 8 },
        senderFrame: { url: 'http://127.0.0.1:5173/?theme=light&colorTheme=macos' },
      } as any),
    ).toBe(true)
    expect(
      isTrustedIpcEvent({
        sender: { id: 8 },
        senderFrame: { url: 'http://127.0.0.1:4173/?theme=light' },
      } as any),
    ).toBe(false)
  })
})
