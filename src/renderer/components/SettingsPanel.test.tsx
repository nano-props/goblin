// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SettingsPanel } from '#/renderer/components/SettingsPanel.tsx'

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    success: toastMocks.success,
    error: toastMocks.error,
  },
}))

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const testWindow = window as unknown as { goblin?: unknown }
const notifyBell = vi.fn(async () => true)

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  notifyBell.mockClear()
  toastMocks.success.mockClear()
  toastMocks.error.mockClear()
  testWindow.goblin = {
    homeDir: '/Users/tester',
    pathForFile: () => '',
    invokeRpc: async () => null,
    abortRpc: async () => true,
    onEvent: () => () => {},
    terminal: {
      open: vi.fn(),
      restart: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      close: vi.fn(),
      pruneRepo: vi.fn(),
      notifyBell,
      onOutput: vi.fn(() => () => {}),
      onExit: vi.fn(() => () => {}),
    },
  }
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  document.body.innerHTML = ''
  delete testWindow.goblin
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

describe('SettingsPanel', () => {
  test('can trigger a test terminal notification from settings', async () => {
    render(<SettingsPanel open page="general" onPageChange={() => {}} onClose={() => {}} />)

    await act(async () => {
      buttonByText('settings.terminal-notifications-test-button').click()
      await Promise.resolve()
    })

    expect(notifyBell).toHaveBeenCalledWith({
      title: 'settings.terminal-notifications-test-title',
      body: 'settings.terminal-notifications-test-body',
    })
    expect(toastMocks.success).toHaveBeenCalledWith('settings.terminal-notifications-test-sent', {
      description: 'settings.terminal-notifications-test-sent-hint',
    })
  })
})

function render(element: React.ReactNode) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => {
    root!.render(element)
  })
}

function buttonByText(text: string): HTMLButtonElement {
  const buttons = Array.from(document.body.querySelectorAll('button'))
  const match = buttons.find((button) => button.textContent?.includes(text))
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Missing button with text: ${text}`)
  return match
}
