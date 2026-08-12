import { describe, expect, test, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { registerClientWindowSurface } from '#/main/client-surface-registry.ts'
import {
  allowTrustedAppUrlForWebContents,
  isTrustedIpcEvent,
  registerTrustedAppUrl,
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
    registerSurface(1)
    expect(
      isTrustedIpcEvent({
        sender: { id: 1 },
        senderFrame: { url: 'http://127.0.0.1:4173/?theme=light' },
      }),
    ).toBe(false)
  })

  test('does not trust an app URL from an unregistered webContents id', () => {
    registerTrustedAppUrl('http://127.0.0.1:5173/')

    expect(
      isTrustedIpcEvent({
        sender: { id: 99 },
        senderFrame: { url: 'http://127.0.0.1:5173/?theme=light' },
      }),
    ).toBe(false)
  })

  test('trusts registered webContents only on the registered app origin', () => {
    registerTrustedAppUrl('http://127.0.0.1:5173/')
    registerSurface(7)

    expect(
      isTrustedIpcEvent({
        sender: { id: 7 },
        senderFrame: { url: 'http://127.0.0.1:5173/?theme=light' },
      }),
    ).toBe(true)
    expect(
      isTrustedIpcEvent({
        sender: { id: 7 },
        senderFrame: { url: 'http://127.0.0.1:4173/?theme=light' },
      }),
    ).toBe(false)
  })

  test('trusts IPC from a registered window surface without explicit webContents registration', () => {
    registerTrustedAppUrl('http://127.0.0.1:5173/')
    registerSurface(17)

    expect(
      isTrustedIpcEvent({
        sender: { id: 17 },
        senderFrame: { url: 'http://127.0.0.1:5173/?theme=light' },
      }),
    ).toBe(true)
  })

  test('trusts the registered dev server app origin across history-routed paths', () => {
    registerTrustedAppUrl('http://127.0.0.1:5173/')
    registerSurface(8)

    expect(
      isTrustedIpcEvent({
        sender: { id: 8 },
        senderFrame: { url: 'http://127.0.0.1:5173/?theme=light&colorTheme=macos' },
      }),
    ).toBe(true)
    expect(
      isTrustedIpcEvent({
        sender: { id: 8 },
        senderFrame: { url: 'http://127.0.0.1:5173/settings/general?theme=light&colorTheme=macos' },
      }),
    ).toBe(true)
    expect(
      isTrustedIpcEvent({
        sender: { id: 8 },
        senderFrame: { url: 'http://127.0.0.1:4173/?theme=light' },
      }),
    ).toBe(false)
  })

  test('scopes a trusted webContents to the specific app origin it loaded', () => {
    const webContents = { id: 18, once: vi.fn() }
    registerTrustedAppUrl('http://127.0.0.1:5173/')
    registerSurface(webContents.id)
    allowTrustedAppUrlForWebContents(webContents, 'http://127.0.0.1:5173/?theme=light')

    expect(
      isTrustedIpcEvent({
        sender: { id: 18 },
        senderFrame: { url: 'http://127.0.0.1:5173/settings?theme=dark' },
      }),
    ).toBe(true)
    expect(
      isTrustedIpcEvent({
        sender: { id: 18 },
        senderFrame: { url: 'http://127.0.0.1:4173/?theme=light' },
      }),
    ).toBe(false)
  })
})

function registerSurface(webContentsId: number): void {
  registerClientWindowSurface(
    {
      isDestroyed: () => false,
      webContents: { id: webContentsId, isDestroyed: () => false },
    } as unknown as BrowserWindow,
    { windowKey: 'primary' },
  )
}
