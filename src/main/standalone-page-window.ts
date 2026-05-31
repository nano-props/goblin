// Controller for singleton auxiliary BrowserWindows that host a single
// renderer surface and optionally support page routing + close-time
// lifecycle hooks.
//
// Boundary:
// - This module owns open/reopen/focus/close orchestration.
// - It does NOT decide surface identity/capabilities implicitly; callers
//   provide a surface spec explicitly.

import { app, type BrowserWindow } from 'electron'
import { attachRendererSurfaceWindow, detachRendererSurfaceWindow } from '#/main/renderer-surface.ts'
import { windowPageSetChannel } from '#/shared/window-page.ts'
import type { WindowFlushResult } from '#/shared/window-lifecycle.ts'
import { flushWindowLifecycle, forgetWindowLifecycle } from '#/main/window-lifecycle.ts'
import {
  closeAuxWindow,
  getAuxWindow,
  isAuxWindowOpen,
  surfaceSupportsCapability,
} from '#/main/window-registry.ts'
import type { RendererSurfaceSpec } from '#/main/window-registry.ts'

const DEFAULT_BEFORE_CLOSE_TIMEOUT_MS = 1500

interface StandalonePageWindowOptions<TPage extends string> {
  surface: RendererSurfaceSpec
  logLabel: string
  defaultPage: TPage
  createWindow: () => BrowserWindow | Promise<BrowserWindow>
  loadWindow: (win: BrowserWindow, page: TPage) => Promise<void>
  lifecycle?: {
    // Opt-in close-time flush for renderer state that lives outside the
    // persisted store graph (draft form edits, in-flight shortcut capture,
    // etc.). Future aux windows should enable this whenever a user-visible
    // interaction could be lost by closing the BrowserWindow directly.
    flushOnClose?: boolean
    onFlushResult?: (result: WindowFlushResult, win: BrowserWindow) => void
    onBeforeClose?: (win: BrowserWindow) => Promise<void> | void
    beforeCloseTimeoutMs?: number
    onClosed?: (win: BrowserWindow) => void
    onShown?: (win: BrowserWindow, reason: 'created' | 'reopened') => void
  }
}

interface StandalonePageWindowController<TPage extends string> {
  getWindow: () => BrowserWindow | null
  isOpen: () => boolean
  openWindow: (page?: TPage) => Promise<BrowserWindow>
  closeWindow: () => Promise<void>
}

export function createStandalonePageWindow<TPage extends string>({
  surface,
  logLabel,
  defaultPage,
  createWindow,
  loadWindow,
  lifecycle,
}: StandalonePageWindowOptions<TPage>): StandalonePageWindowController<TPage> {
  const { windowKey } = surface
  let currentWindow: BrowserWindow | null = null
  let creation: Promise<BrowserWindow> | null = null

  const getWindow = () => {
    const registered = getAuxWindow(windowKey)
    if (registered) {
      currentWindow = registered
      return registered
    }
    if (currentWindow && !currentWindow.isDestroyed()) return currentWindow
    currentWindow = null
    return null
  }

  const sendPage = (win: BrowserWindow, page: TPage) => {
    const wc = win.webContents
    if (wc.isDestroyed()) return
    if (!surfaceSupportsCapability(wc.id, 'pageRouting')) return
    const channel = windowPageSetChannel(windowKey)
    if (wc.isLoading()) {
      wc.once('did-finish-load', () => {
        if (wc.isDestroyed()) return
        try {
          wc.send(channel, page)
        } catch {}
      })
      return
    }
    try {
      wc.send(channel, page)
    } catch {}
  }

  const revealWindow = (win: BrowserWindow) => {
    if (win.isMinimized()) win.restore()
    if (!win.isVisible()) win.show()
    win.focus()
  }

  const runBeforeClose = async (win: BrowserWindow) => {
    if (!lifecycle?.onBeforeClose) return
    const timeoutMs =
      typeof lifecycle.beforeCloseTimeoutMs === 'number' && Number.isFinite(lifecycle.beforeCloseTimeoutMs)
        ? Math.max(0, lifecycle.beforeCloseTimeoutMs)
        : DEFAULT_BEFORE_CLOSE_TIMEOUT_MS
    if (timeoutMs === 0) {
      await lifecycle.onBeforeClose(win)
      return
    }
    await Promise.race([
      Promise.resolve(lifecycle.onBeforeClose(win)),
      new Promise<void>((resolve) => {
        setTimeout(() => {
          // Close hooks are best-effort. A hung renderer should not strand a
          // singleton aux window forever, so we warn and continue closing once
          // the timeout elapses.
          console.warn(`[${windowKey}-window] onBeforeClose timed out after ${timeoutMs}ms`)
          resolve()
        }, timeoutMs)
      }),
    ])
  }

  const openWindow = async (page: TPage = defaultPage) => {
    await app.whenReady()
    const existing = getWindow()
    if (existing) {
      revealWindow(existing)
      lifecycle?.onShown?.(existing, 'reopened')
      sendPage(existing, page)
      return existing
    }
    if (creation) {
      return creation.then((win) => {
        revealWindow(win)
        sendPage(win, page)
        return win
      })
    }
    creation = (async () => {
      const win = await createWindow()
      const wcId = win.webContents.id
      currentWindow = win
      attachRendererSurfaceWindow(win, { logLabel, surface })
      let closing = false
      let closedAfterLifecycle = false
      if (lifecycle?.flushOnClose || lifecycle?.onBeforeClose) {
        win.on('close', (event) => {
          if (closedAfterLifecycle) return
          event.preventDefault()
          if (closing) return
          closing = true
          void (async () => {
            try {
              let flushResult: WindowFlushResult = { ok: true, errors: [] }
              if (lifecycle?.flushOnClose) {
                // Flush runs before any custom close hook so renderer-side
                // persistence gets the first shot at capturing UI state.
                flushResult = await flushWindowLifecycle(win, windowKey)
                lifecycle.onFlushResult?.(flushResult, win)
              }
              await runBeforeClose(win)
            } catch (err) {
              console.warn(`[${windowKey}-window] lifecycle close hook failed`, err)
            } finally {
              closedAfterLifecycle = true
              if (!win.isDestroyed()) win.close()
            }
          })()
        })
      }
      win.on('closed', () => {
        forgetWindowLifecycle(windowKey, wcId)
        detachRendererSurfaceWindow(win, surface)
        if (currentWindow === win) currentWindow = null
        lifecycle?.onClosed?.(win)
      })
      await loadWindow(win, page)
      lifecycle?.onShown?.(win, 'created')
      return win
    })().finally(() => {
      creation = null
    })
    return creation
  }

  return { getWindow, isOpen: () => isAuxWindowOpen(windowKey), openWindow, closeWindow: () => closeAuxWindow(windowKey) }
}
