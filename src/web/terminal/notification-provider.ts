import type {
  TerminalMutationResult,
  TerminalNotifyBellInput,
  TerminalTestNotificationInput,
} from '#/shared/terminal-types.ts'
import { emitClientLocalEvent } from '#/web/bridge/local-events.ts'
import { readNativeBridge } from '#/web/bridge/native.ts'

export interface TerminalNotificationProvider {
  notifyBell: (input: TerminalNotifyBellInput) => Promise<TerminalMutationResult>
  sendTestNotification: (input: TerminalTestNotificationInput) => Promise<boolean>
}

export function createTerminalNotificationProvider(): TerminalNotificationProvider {
  const bridge = readNativeBridge()
  if (bridge) {
    return {
      notifyBell: (input) => bridge.terminal.notifyBell(input),
      sendTestNotification: (input) => bridge.terminal.sendTestNotification(input),
    }
  }
  return createBrowserTerminalNotificationProvider()
}

function createBrowserTerminalNotificationProvider(): TerminalNotificationProvider {
  return {
    notifyBell(input) {
      return showBrowserNotification(input.title, input.body, () => {
        emitClientLocalEvent({
          type: 'terminal-bell-click',
          terminalSessionId: input.terminalSessionId,
          session: input.session,
        })
      })
    },
    sendTestNotification(input) {
      return showBrowserNotification(input.title, input.body)
    },
  }
}

async function showBrowserNotification(title: string, body: string, onClick?: () => void): Promise<boolean> {
  if (typeof Notification === 'undefined') return false
  let permission = Notification.permission
  if (permission !== 'granted') {
    if (permission === 'denied') return false
    try {
      permission = await Notification.requestPermission()
    } catch {
      return false
    }
  }
  if (permission !== 'granted') return false
  try {
    const notification = new Notification(title, { body, silent: true })
    notification.onclick = () => {
      onClick?.()
      try {
        window.focus()
      } catch {}
      notification.close()
    }
    return true
  } catch {
    return false
  }
}
