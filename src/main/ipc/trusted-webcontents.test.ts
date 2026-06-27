import { describe, expect, test, vi } from 'vitest'
import { registerClientWindowSurface } from '#/main/client-surface-registry.ts'
import {
  allowTrustedAppUrlForWebContents,
  isTrustedAppUrl,
  isTrustedIpcEvent,
  registerTrustedAppUrl,
  registerTrustedWebContents,
} from '#/main/ipc/trusted-webcontents.ts'

const mocks = vi.hoisted(() => ({
  getFocusedWindow: vi.fn(() => null),
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getFocusedWindow: mocks.getFocusedWindow,
  },
}))

describe('trusted app web contents', () => {
  test('does not trust arbitrary app origins before registration', () => {
    expect(isTrustedAppUrl('http://127.0.0.1:4173/?theme=light')).toBe(false)
  })

  test('does not trust an app URL from an unregistered webContents id', () => {
    registerTrustedAppUrl('http://127.0.0.1:5173/')
    registerTrustedWebContents({ id: 1, once: vi.fn() } as any)

    expect(
      isTrustedIpcEvent({
        sender: { id: 99 },
        senderFrame: { url: 'http://127.0.0.1:5173/?theme=light' },
      } as any),
    ).toBe(false)
  })

  test('trusts registered webContents only on the registered app origin', () => {
    registerTrustedAppUrl('http://127.0.0.1:5173/')
    registerTrustedWebContents({ id: 7, once: vi.fn() } as any)

    expect(
      isTrustedIpcEvent({
        sender: { id: 7 },
        senderFrame: { url: 'http://127.0.0.1:5173/?theme=light' },
      } as any),
    ).toBe(true)
    expect(
      isTrustedIpcEvent({
        sender: { id: 7 },
        senderFrame: { url: 'http://127.0.0.1:4173/?theme=light' },
      } as any),
    ).toBe(false)
  })

  test('trusts IPC from a registered window surface without explicit webContents registration', () => {
    registerTrustedAppUrl('http://127.0.0.1:5173/')
    registerClientWindowSurface(
      {
        isDestroyed: () => false,
        webContents: { id: 17, isDestroyed: () => false },
      } as any,
      { windowKey: 'main' },
    )

    expect(
      isTrustedIpcEvent({
        sender: { id: 17 },
        senderFrame: { url: 'http://127.0.0.1:5173/?theme=light' },
      } as any),
    ).toBe(true)
  })

  test('trusts the registered dev server app origin across history-routed paths', () => {
    registerTrustedAppUrl('http://127.0.0.1:5173/')
    registerTrustedWebContents({ id: 8, once: vi.fn() } as any)

    expect(isTrustedAppUrl('http://127.0.0.1:5173/?theme=light')).toBe(true)
    expect(isTrustedAppUrl('http://127.0.0.1:5173/settings')).toBe(true)
    expect(
      isTrustedIpcEvent({
        sender: { id: 8 },
        senderFrame: { url: 'http://127.0.0.1:5173/?theme=light&colorTheme=macos' },
      } as any),
    ).toBe(true)
    expect(
      isTrustedIpcEvent({
        sender: { id: 8 },
        senderFrame: { url: 'http://127.0.0.1:5173/settings/general?theme=light&colorTheme=macos' },
      } as any),
    ).toBe(true)
    expect(
      isTrustedIpcEvent({
        sender: { id: 8 },
        senderFrame: { url: 'http://127.0.0.1:4173/?theme=light' },
      } as any),
    ).toBe(false)
  })

  test('scopes a trusted webContents to the specific app origin it loaded', () => {
    const webContents = { id: 18, once: vi.fn() } as any
    registerTrustedAppUrl('http://127.0.0.1:5173/')
    registerTrustedWebContents(webContents)
    allowTrustedAppUrlForWebContents(webContents, 'http://127.0.0.1:5173/?theme=light')

    expect(
      isTrustedIpcEvent({
        sender: { id: 18 },
        senderFrame: { url: 'http://127.0.0.1:5173/settings?theme=dark' },
      } as any),
    ).toBe(true)
    expect(
      isTrustedIpcEvent({
        sender: { id: 18 },
        senderFrame: { url: 'http://127.0.0.1:4173/?theme=light' },
      } as any),
    ).toBe(false)
  })
})
