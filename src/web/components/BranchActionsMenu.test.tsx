// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { BranchActionsPopover } from '#/web/components/BranchActionsMenu.tsx'
import type { BranchActionItem } from '#/web/hooks/useBranchActionItems.ts'

vi.mock('#/web/stores/i18n.ts', () => ({
  useT: () => (key: string) => key,
}))

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  const win = window as typeof window & { PointerEvent?: typeof PointerEvent }
  win.PointerEvent ??= MouseEvent as unknown as typeof PointerEvent
  globalThis.PointerEvent ??= win.PointerEvent
  globalThis.requestAnimationFrame ??= (callback: FrameRequestCallback) => window.setTimeout(callback, 0)
  globalThis.cancelAnimationFrame ??= (id: number) => window.clearTimeout(id)
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

function renderPopover(item: BranchActionItem, open?: boolean, onOpenChange?: (open: boolean) => void) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => {
    root!.render(<BranchActionsPopover mainItems={[item]} destructiveItems={[]} open={open} onOpenChange={onOpenChange} />)
  })
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
    expect(trigger.getAttribute('aria-expanded')).toBe('true')

    const item = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === 'Status',
    )
    expect(item).toBeTruthy()

    await user.click(item!)

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
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
