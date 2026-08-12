// @vitest-environment jsdom

import { cleanup, screen } from '@testing-library/vue'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { ShortcutSettings } from '#/web/components/settings/ShortcutSettings.tsx'

const shortcutMocks = vi.hoisted(() => ({
  setShortcutsDisabled: vi.fn(),
  setGlobalShortcutDisabled: vi.fn(),
  setGlobalShortcut: vi.fn(),
  globalShortcutPending: { value: false },
}))

vi.mock('#/web/app-shell-client.ts', () => ({ canUseGlobalShortcutSettings: () => true }))
vi.mock('#/web/runtime-settings-shortcuts.ts', () => ({
  useShortcutSettings: () => ({
    value: {
      shortcutsDisabled: false,
      globalShortcutDisabled: false,
      globalShortcut: 'Alt+Space',
      globalShortcutRegistered: false,
    },
  }),
  useShortcutSettingsController: () => ({
    ...shortcutMocks,
    globalShortcutPending: shortcutMocks.globalShortcutPending,
  }),
}))

afterEach(() => {
  cleanup()
  shortcutMocks.setShortcutsDisabled.mockReset()
  shortcutMocks.setGlobalShortcutDisabled.mockReset()
  shortcutMocks.setGlobalShortcut.mockReset()
  shortcutMocks.globalShortcutPending.value = false
})

describe('ShortcutSettings', () => {
  test('shows a registration failure without offering a compensating retry', () => {
    renderInJsdom(<ShortcutSettings />)

    expect(screen.getByRole('status').textContent).toBe('settings.global-shortcut-conflict')
    expect(screen.queryByText('error.try-again')).toBeNull()
  })

  test('surfaces a failed native projection without replaying the preference write', async () => {
    renderInJsdom(<ShortcutSettings />)
    await userEvent.click(screen.getByRole('button', { name: 'settings.global-shortcut-reset' }))
    const firstCallback = shortcutMocks.setGlobalShortcut.mock.calls[0]?.[1]
    firstCallback?.({ kind: 'committed-projection-failed' })

    await vi.waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('settings.global-shortcut-projection-failed'),
    )
    expect(screen.queryByText('error.try-again')).toBeNull()
    expect(shortcutMocks.setGlobalShortcut).toHaveBeenCalledOnce()
  })

  test('does not offer retry for a local shortcut validation error', async () => {
    renderInJsdom(<ShortcutSettings />)
    const record = screen.getByRole('button', { name: 'settings.global-shortcut-record' })

    await userEvent.click(record)
    await userEvent.keyboard('A')

    expect(screen.getByRole('status').textContent).toBe('settings.global-shortcut-invalid')
    expect(screen.queryByText('error.try-again')).toBeNull()
  })

  test('blocks every global shortcut write control while a write is pending', () => {
    shortcutMocks.globalShortcutPending.value = true
    renderInJsdom(<ShortcutSettings />)

    expect(screen.getByRole('switch', { name: 'settings.shortcuts-disable-global' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'settings.global-shortcut-record' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'settings.global-shortcut-reset' }).hasAttribute('disabled')).toBe(true)
  })
})
