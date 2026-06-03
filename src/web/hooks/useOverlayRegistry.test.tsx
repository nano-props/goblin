// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { useOverlayRegistry } from '#/web/hooks/useOverlayRegistry.ts'

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

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

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
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

describe('useOverlayRegistry', () => {
  test('opens, closes, and closes all overlays generically', () => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    act(() => {
      root!.render(<Harness />)
    })

    click('#open-settings')
    click('#set-clone-open')
    expect(text('#settings-open')).toBe('open')
    expect(text('#clone-open')).toBe('open')
    expect(text('#open-repo-open')).toBe('closed')
    expect(text('#any-open')).toBe('open')

    click('#close-settings')
    expect(text('#settings-open')).toBe('closed')
    expect(text('#clone-open')).toBe('open')

    click('#close-all')
    expect(text('#settings-open')).toBe('closed')
    expect(text('#clone-open')).toBe('closed')
    expect(text('#open-repo-open')).toBe('closed')
    expect(text('#any-open')).toBe('closed')
  })
})

function click(selector: string) {
  const element = container?.querySelector(selector)
  if (!(element instanceof HTMLButtonElement)) throw new Error(`Missing button: ${selector}`)
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

function text(selector: string): string {
  const element = container?.querySelector(selector)
  if (!(element instanceof HTMLOutputElement)) throw new Error(`Missing output: ${selector}`)
  return element.textContent ?? ''
}
