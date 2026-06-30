import type {
  TerminalMutationResult,
  TerminalNotifyBellInput,
  TerminalTestNotificationInput,
} from '#/shared/terminal-types.ts'
import { emitClientLocalEvent } from '#/web/local-events.ts'
import { readNativeBridge } from '#/web/native-bridge.ts'

export interface TerminalNotificationProvider {
  notifyBell: (input: TerminalNotifyBellInput) => Promise<TerminalMutationResult>
  sendTestNotification: (input: TerminalTestNotificationInput) => Promise<boolean>
}

type MaybeTerminalNotificationProvider = {
  notifyBell: (input: TerminalNotifyBellInput) => Promise<TerminalMutationResult> | undefined
  sendTestNotification: (input: TerminalTestNotificationInput) => Promise<boolean> | undefined
}

export function createTerminalNotificationProvider(): TerminalNotificationProvider {
  return createFallbackTerminalNotificationProvider([
    createNativeTerminalNotificationProvider(),
    createBrowserTerminalNotificationProvider(),
  ])
}

function createFallbackTerminalNotificationProvider(
  providers: MaybeTerminalNotificationProvider[],
): TerminalNotificationProvider {
  return {
    notifyBell(input) {
      for (const provider of providers) {
        const result = provider.notifyBell(input)
        if (result !== undefined) return result
      }
      return Promise.resolve(false)
    },
    sendTestNotification(input) {
      for (const provider of providers) {
        const result = provider.sendTestNotification(input)
        if (result !== undefined) return result
      }
      return Promise.resolve(false)
    },
  }
}

function createNativeTerminalNotificationProvider(): MaybeTerminalNotificationProvider {
  return {
    notifyBell(input) {
      return readNativeBridge()?.terminal?.notifyBell?.(input)
    },
    sendTestNotification(input) {
      return readNativeBridge()?.terminal?.sendTestNotification?.(input)
    },
  }
}

function createBrowserTerminalNotificationProvider(): MaybeTerminalNotificationProvider {
  return {
    notifyBell(input) {
      return showBrowserNotification(input.title, input.body, () => {
        emitClientLocalEvent({
          type: 'terminal-bell-click',
          repoRoot: input.repoRoot,
          terminalSessionId: input.terminalSessionId,
          terminalWorktreeKey: input.terminalWorktreeKey,
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
