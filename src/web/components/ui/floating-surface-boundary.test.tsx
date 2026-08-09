// @vitest-environment jsdom

import { userEvent } from '@testing-library/user-event'
import { screen, waitFor } from '@testing-library/vue'
import { PopoverTrigger } from 'reka-ui'
import { beforeEach, describe, expect, test } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { FloatingSurfaceBoundary } from '#/web/components/ui/floating-surface-boundary.tsx'
import { Popover, PopoverContent } from '#/web/components/ui/popover.tsx'
import { defineComponent, ref } from 'vue'

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

const UncontrolledPopoverBoundary = defineComponent({
  name: 'UncontrolledPopoverBoundary',
  setup() {
    const pinned = ref(false)

    return () => (
      <FloatingSurfaceBoundary onPinnedChange={(nextPinned) => (pinned.value = nextPinned)}>
        <div data-testid="pin-state">{pinned.value ? 'pinned' : 'unpinned'}</div>
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
  },
})

const UnmountOpenPopoverBoundary = defineComponent({
  name: 'UnmountOpenPopoverBoundary',
  setup() {
    const mounted = ref(true)
    const pinned = ref(false)

    return () => (
      <FloatingSurfaceBoundary onPinnedChange={(nextPinned) => (pinned.value = nextPinned)}>
        <div data-testid="pin-state">{pinned.value ? 'pinned' : 'unpinned'}</div>
        <button type="button" onClick={() => (mounted.value = false)}>
          Unmount menu
        </button>
        {mounted.value ? (
          <Popover open onOpenChange={() => {}}>
            <PopoverTrigger asChild>
              <button type="button">Open menu</button>
            </PopoverTrigger>
          </Popover>
        ) : null}
      </FloatingSurfaceBoundary>
    )
  },
})

const MultiplePopoverBoundary = defineComponent({
  name: 'MultiplePopoverBoundary',
  setup() {
    const firstOpen = ref(false)
    const secondOpen = ref(false)
    const pinned = ref(false)

    return () => (
      <FloatingSurfaceBoundary onPinnedChange={(nextPinned) => (pinned.value = nextPinned)}>
        <div data-testid="pin-state">{pinned.value ? 'pinned' : 'unpinned'}</div>
        <button type="button" onClick={() => (firstOpen.value = !firstOpen.value)}>
          {firstOpen.value ? 'Close first menu' : 'Open first menu'}
        </button>
        <button type="button" onClick={() => (secondOpen.value = !secondOpen.value)}>
          {secondOpen.value ? 'Close second menu' : 'Open second menu'}
        </button>
        <Popover open={firstOpen.value} onOpenChange={(nextOpen) => (firstOpen.value = nextOpen)}>
          <PopoverTrigger asChild>
            <button type="button">First menu trigger</button>
          </PopoverTrigger>
        </Popover>
        <Popover open={secondOpen.value} onOpenChange={(nextOpen) => (secondOpen.value = nextOpen)}>
          <PopoverTrigger asChild>
            <button type="button">Second menu trigger</button>
          </PopoverTrigger>
        </Popover>
      </FloatingSurfaceBoundary>
    )
  },
})
