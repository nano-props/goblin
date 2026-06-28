// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { useOverlayRegistry } from '#/web/hooks/useOverlayRegistry.ts'

function Harness() {
  const overlays = useOverlayRegistry(['settings', 'clone', 'openRepo'] as const)

  return (
    <>
      <button id="open-settings" type="button" onClick={() => overlays.open('settings')}>
        open settings
      </button>
      <button id="set-clone-open" type="button" onClick={() => overlays.setOpen('clone', true)}>
        open clone
      </button>
      <button id="close-settings" type="button" onClick={() => overlays.close('settings')}>
        close settings
      </button>
      <button id="close-all" type="button" onClick={overlays.closeAll}>
        close all
      </button>
      <output id="settings-open">{overlays.state.settings ? 'open' : 'closed'}</output>
      <output id="clone-open">{overlays.state.clone ? 'open' : 'closed'}</output>
      <output id="open-repo-open">{overlays.state.openRepo ? 'open' : 'closed'}</output>
      <output id="any-open">{overlays.anyOpen ? 'open' : 'closed'}</output>
    </>
  )
}

describe('useOverlayRegistry', () => {
  test('opens, closes, and closes all overlays generically', () => {
    const { container } = renderInJsdom(<Harness />)

    click(container, '#open-settings')
    click(container, '#set-clone-open')
    expect(text(container, '#settings-open')).toBe('open')
    expect(text(container, '#clone-open')).toBe('open')
    expect(text(container, '#open-repo-open')).toBe('closed')
    expect(text(container, '#any-open')).toBe('open')

    click(container, '#close-settings')
    expect(text(container, '#settings-open')).toBe('closed')
    expect(text(container, '#clone-open')).toBe('open')

    click(container, '#close-all')
    expect(text(container, '#settings-open')).toBe('closed')
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
