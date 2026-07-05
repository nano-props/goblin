// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, test } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { type AppOverlayKey, useAppOverlays } from '#/web/hooks/useAppOverlays.ts'
import { resetReposStore } from '#/web/test-utils/bridge.ts'

function Harness() {
  const overlays = useAppOverlays()

  return (
    <>
      <button id="open-clone" type="button" onClick={overlays.openCloneRepo}>
        open clone
      </button>
      <button id="open-repo" type="button" onClick={overlays.openRepoPathDialog}>
        open repo
      </button>
      <button id="close-all" type="button" onClick={overlays.closeAllOverlays}>
        close all
      </button>
      <output id="clone-open">{overlays.state.clone.open ? 'open' : 'closed'}</output>
      <output id="open-repo-open">{overlays.state.openRepo.open ? 'open' : 'closed'}</output>
      <output id="any-open">{overlays.anyOpen ? 'open' : 'closed'}</output>
    </>
  )
}

function RoutedHarness() {
  const [overlay, setOverlay] = useState<AppOverlayKey | null>(null)
  const overlays = useAppOverlays({
    routeOverlay: overlay,
    onRouteOverlayChange: setOverlay,
  })

  return (
    <>
      <button id="open-clone" type="button" onClick={overlays.openCloneRepo}>
        open clone
      </button>
      <button id="open-repo" type="button" onClick={overlays.openRepoPathDialog}>
        open repo
      </button>
      <button id="close-all" type="button" onClick={overlays.closeAllOverlays}>
        close all
      </button>
      <output id="clone-open">{overlays.state.clone.open ? 'open' : 'closed'}</output>
      <output id="open-repo-open">{overlays.state.openRepo.open ? 'open' : 'closed'}</output>
      <output id="any-open">{overlays.anyOpen ? 'open' : 'closed'}</output>
    </>
  )
}

beforeEach(() => {
  resetReposStore()
})

describe('useAppOverlays', () => {
  test('tracks non-settings overlays centrally and resets all overlays together', () => {
    const { container } = renderInJsdom(<Harness />)

    click(container, '#open-clone')
    click(container, '#open-repo')
    expect(text(container, '#clone-open')).toBe('open')
    expect(text(container, '#open-repo-open')).toBe('open')
    expect(text(container, '#any-open')).toBe('open')

    click(container, '#close-all')
    expect(text(container, '#clone-open')).toBe('closed')
    expect(text(container, '#open-repo-open')).toBe('closed')
    expect(text(container, '#any-open')).toBe('closed')
  })

  test('can derive overlay state from a routed overlay source', () => {
    const { container } = renderInJsdom(<RoutedHarness />)

    click(container, '#open-clone')
    expect(text(container, '#clone-open')).toBe('open')
    expect(text(container, '#open-repo-open')).toBe('closed')
    expect(text(container, '#any-open')).toBe('open')

    click(container, '#open-repo')
    expect(text(container, '#clone-open')).toBe('closed')
    expect(text(container, '#open-repo-open')).toBe('open')

    click(container, '#close-all')
    expect(text(container, '#clone-open')).toBe('closed')
    expect(text(container, '#open-repo-open')).toBe('closed')
    expect(text(container, '#any-open')).toBe('closed')
  })

})

function click(container: HTMLElement, selector: string) {
  const element = container.querySelector(selector)
  if (!(element instanceof HTMLButtonElement)) throw new Error(`Missing button: ${selector}`)
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

function text(container: HTMLElement, selector: string): string {
  const element = container.querySelector(selector)
  if (!(element instanceof HTMLOutputElement)) throw new Error(`Missing output: ${selector}`)
  return element.textContent ?? ''
}
