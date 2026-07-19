import { BrowserWindow, Notification, app, ipcMain } from 'electron'
import type { WebContents } from 'electron'
import { broadcastClientEffectIntent } from '#/main/client-surface-events.ts'
import { activatePrimaryWindow } from '#/main/window.ts'
import { platform } from '#/main/platform.ts'
import { isTrustedIpcEvent } from '#/main/ipc/trusted-webcontents.ts'
import { terminalNodeLog } from '#/node/logger.ts'
import { isValidTerminalNotifyBellInput, isValidTerminalTestNotificationInput } from '#/shared/terminal-validators.ts'
import type {
  TerminalMutationResult,
  TerminalNotifyBellInput,
  TerminalTestNotificationInput,
} from '#/shared/terminal-types.ts'
import {
  TERMINAL_NOTIFY_BELL_CHANNEL,
  TERMINAL_SEND_TEST_NOTIFICATION_CHANNEL,
  TERMINAL_SET_BADGE_CHANNEL,
} from '#/shared/ipc-channels.ts'

let wired = false

export function wireTerminalIpc(): void {
  if (wired) return
  wired = true

  ipcMain.handle(
    TERMINAL_NOTIFY_BELL_CHANNEL,
    async (event, input: TerminalNotifyBellInput): Promise<TerminalMutationResult> => {
      if (!isTrustedIpcEvent(event) || !isValidTerminalNotifyBellInput(input)) return false
      return notifyTerminalBell(event.sender, input)
    },
  )
  ipcMain.handle(
    TERMINAL_SEND_TEST_NOTIFICATION_CHANNEL,
    async (event, input: TerminalTestNotificationInput): Promise<boolean> => {
      if (!isTrustedIpcEvent(event) || !isValidTerminalTestNotificationInput(input)) return false
      if (!Notification.isSupported()) return false
      return showNotificationWithResult(input.title, input.body, null)
    },
  )
  ipcMain.on(TERMINAL_SET_BADGE_CHANNEL, (event, count: unknown): void => {
    if (!isTrustedIpcEvent(event)) return
    const n = typeof count === 'number' && Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0
    if (platform.isMacOS()) app.dock?.setBadge(n > 0 ? String(n) : '')
  })
}

// How long to wait for a 'show' or 'failed' event before treating the
// notification as failed. In practice 'show' fires synchronously on macOS,
// so this only kicks in if neither event fires at all (shouldn't happen in
// normal operation, but guards against a permanent IPC hang).
const NOTIFICATION_SHOW_TIMEOUT_MS = 5000

async function notifyTerminalBell(webContents: WebContents, input: TerminalNotifyBellInput): Promise<boolean> {
  const win = BrowserWindow.fromWebContents(webContents)
  if (!win || win.isDestroyed() || webContents.isDestroyed()) return false
  try {
    // flashFrame and dock bounce are independent attention cues that work even
    // when system notifications are blocked (e.g. permission denied). They run
    // unconditionally so background terminal activity is never completely silent
    // regardless of notification settings.
    if (!win.isFocused()) {
      win.flashFrame(true)
      setTimeout(() => {
        try {
          if (!win.isDestroyed()) win.flashFrame(false)
        } catch {}
      }, 1500)
    }
    if (platform.isMacOS()) app.dock?.bounce('informational')
    // flashFrame and dock bounce already delivered the attention cue above.
    // If system notifications are unsupported we still return true — the user
    // was notified via those mechanisms, so the bell was not silently dropped.
    if (!Notification.isSupported()) return true
    // showNotificationWithResult is async: it waits for the 'show' or 'failed'
    // event so the caller gets an accurate result instead of an optimistic true.
    return await showNotificationWithResult(
      input.title,
      input.body,
      input.workspaceId,
      input.terminalSessionId,
      input.terminalWorktreeKey,
    )
  } catch (err) {
    terminalNodeLog.warn({ err }, 'failed to show bell notification')
    return false
  }
}

// On macOS, Notification.show() is NOT a reliable signal of delivery on its
// own — calling show() returns immediately regardless of whether the system
// will actually display the notification.
//
// The correct way to detect failure is to listen for the 'failed' event, which
// Electron emits (via UNUserNotificationCenter's completion handler) when:
//   - the app binary is unsigned (common in development builds), or
//   - the user has denied notification permission for this app.
//
// We race 'show' vs 'failed' and resolve accordingly. The timeout is a last
// resort: in practice one of the two events always fires, but it prevents the
// IPC call from hanging indefinitely if neither does.
//
function showNotificationWithResult(
  title: string,
  body: string,
  workspaceId: string | null,
  terminalSessionId?: string,
  terminalWorktreeKey?: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    const notif = new Notification({ title, body })
    let settled = false
    const settle = (result: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => settle(false), NOTIFICATION_SHOW_TIMEOUT_MS)
    notif.once('show', () => settle(true))
    notif.once('failed', () => settle(false))
    notif.once('click', () => {
      // Bring the window to the foreground, then tell the client to switch
      // to the workspace and open the terminal view (only when workspaceId is known).
      void activatePrimaryWindow().catch(() => {})
      if (workspaceId)
        broadcastClientEffectIntent({ type: 'terminal-bell-click', workspaceId, terminalSessionId, terminalWorktreeKey })
    })
    notif.show()
  })
}
