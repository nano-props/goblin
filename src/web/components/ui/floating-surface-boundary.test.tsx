// @vitest-environment jsdom

import { userEvent } from '@testing-library/user-event'
import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { FloatingSurfaceBoundary } from '#/web/components/ui/floating-surface-boundary.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '#/web/components/ui/popover.tsx'
import { useState } from 'react'

beforeEach(() => {
  const win = window as typeof window & { PointerEvent?: typeof PointerEvent }
  win.PointerEvent ??= MouseEvent as unknown as typeof PointerEvent
  globalThis.PointerEvent ??= win.PointerEvent
})

describe('FloatingSurfaceBoundary', () => {
  test('tracks an uncontrolled Popover while it is open', async () => {
    const user = userEvent.setup()
    renderInJsdom(<UncontrolledPopoverBoundary />)

    expect(screen.getByTestId('pin-state').textContent).toBe('unpinned')

    await user.click(screen.getByRole('button', { name: 'Toggle menu' }))

    await waitFor(() => {
      expect(screen.getByTestId('pin-state').textContent).toBe('pinned')
    })

    await user.click(screen.getByRole('button', { name: 'Toggle menu' }))

    await waitFor(() => {
      expect(screen.getByTestId('pin-state').textContent).toBe('unpinned')
    })
  })

  test('removes an open Popover contribution when it unmounts', async () => {
    const user = userEvent.setup()
    renderInJsdom(<UnmountOpenPopoverBoundary />)

    await waitFor(() => {
      expect(screen.getByTestId('pin-state').textContent).toBe('pinned')
    })

    await user.click(screen.getByRole('button', { name: 'Unmount menu' }))

    await waitFor(() => {
      expect(screen.getByTestId('pin-state').textContent).toBe('unpinned')
    })
  })

  test('stays pinned until every open Popover closes', async () => {
    const user = userEvent.setup()
    renderInJsdom(<MultiplePopoverBoundary />)

    await user.click(screen.getByRole('button', { name: 'Open first menu' }))
    await user.click(screen.getByRole('button', { name: 'Open second menu' }))

    await waitFor(() => {
      expect(screen.getByTestId('pin-state').textContent).toBe('pinned')
    })

    await user.click(screen.getByRole('button', { name: 'Close first menu' }))

    await waitFor(() => {
      expect(screen.getByTestId('pin-state').textContent).toBe('pinned')
    })

    await user.click(screen.getByRole('button', { name: 'Close second menu' }))

    await waitFor(() => {
      expect(screen.getByTestId('pin-state').textContent).toBe('unpinned')
    })
  })
})

function UncontrolledPopoverBoundary() {
  const [pinned, setPinned] = useState(false)

  return (
    <FloatingSurfaceBoundary onPinnedChange={setPinned}>
      <div data-testid="pin-state">{pinned ? 'pinned' : 'unpinned'}</div>
      <Popover>
        <PopoverTrigger asChild>
          <button type="button">Toggle menu</button>
        </PopoverTrigger>
        <PopoverContent>
          <div>Menu content</div>
        </PopoverContent>
      </Popover>
    </FloatingSurfaceBoundary>
  )
}

function UnmountOpenPopoverBoundary() {
  const [mounted, setMounted] = useState(true)
  const [pinned, setPinned] = useState(false)

  return (
    <FloatingSurfaceBoundary onPinnedChange={setPinned}>
      <div data-testid="pin-state">{pinned ? 'pinned' : 'unpinned'}</div>
      <button type="button" onClick={() => setMounted(false)}>
        Unmount menu
      </button>
      {mounted ? (
        <Popover open onOpenChange={() => {}}>
          <PopoverTrigger asChild>
            <button type="button">Open menu</button>
          </PopoverTrigger>
        </Popover>
      ) : null}
    </FloatingSurfaceBoundary>
  )
}

function MultiplePopoverBoundary() {
  const [firstOpen, setFirstOpen] = useState(false)
  const [secondOpen, setSecondOpen] = useState(false)
  const [pinned, setPinned] = useState(false)

  return (
    <FloatingSurfaceBoundary onPinnedChange={setPinned}>
      <div data-testid="pin-state">{pinned ? 'pinned' : 'unpinned'}</div>
      <button type="button" onClick={() => setFirstOpen((open) => !open)}>
        {firstOpen ? 'Close first menu' : 'Open first menu'}
      </button>
      <button type="button" onClick={() => setSecondOpen((open) => !open)}>
        {secondOpen ? 'Close second menu' : 'Open second menu'}
      </button>
      <Popover open={firstOpen} onOpenChange={setFirstOpen}>
        <PopoverTrigger asChild>
          <button type="button">First menu trigger</button>
        </PopoverTrigger>
      </Popover>
      <Popover open={secondOpen} onOpenChange={setSecondOpen}>
        <PopoverTrigger asChild>
          <button type="button">Second menu trigger</button>
        </PopoverTrigger>
      </Popover>
    </FloatingSurfaceBoundary>
  )
}
