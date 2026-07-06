// @vitest-environment jsdom
import { userEvent } from '@testing-library/user-event'
import { waitFor } from '@testing-library/react'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { BranchActionsPopover } from '#/web/components/BranchActionsMenu.tsx'
import type { BranchActionItem } from '#/web/hooks/useBranchActionItems.ts'

vi.mock('#/web/stores/i18n.ts', () => ({
  useT: () => (key: string) => key,
}))

beforeEach(() => {
  const win = window as typeof window & { PointerEvent?: typeof PointerEvent }
  win.PointerEvent ??= MouseEvent as unknown as typeof PointerEvent
  globalThis.PointerEvent ??= win.PointerEvent
  globalThis.requestAnimationFrame ??= (callback: FrameRequestCallback) => window.setTimeout(callback, 0)
  globalThis.cancelAnimationFrame ??= (id: number) => window.clearTimeout(id)
})

function renderPopover(item: BranchActionItem, open?: boolean, onOpenChange?: (open: boolean) => void) {
  renderInJsdom(<BranchActionsPopover mainItems={[item]} destructiveItems={[]} open={open} onOpenChange={onOpenChange} />)
}

describe('BranchActionsPopover', () => {
  test('closes after selecting an item when uncontrolled', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderPopover({
      id: 'status',
      label: 'Status',
      disabled: false,
      visible: true,
      icon: <span aria-hidden="true" />,
      onSelect,
    })

    const trigger = document.body.querySelector<HTMLButtonElement>('[data-action-popover-trigger]')!
    await user.click(trigger)
    await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('true'))

    const item = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === 'Status',
    )
    expect(item).toBeTruthy()

    await user.click(item!)

    expect(onSelect).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('false'))
  })

  test('does not auto-focus the first item and requests close after selection', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onOpenChange = vi.fn()
    renderPopover({
      id: 'status',
      label: 'Status',
      disabled: false,
      visible: true,
      icon: <span aria-hidden="true" />,
      onSelect,
    }, true, onOpenChange)

    const item = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === 'Status',
    )
    expect(item).toBeTruthy()
    expect(document.activeElement).not.toBe(item)

    await user.click(item!)

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
