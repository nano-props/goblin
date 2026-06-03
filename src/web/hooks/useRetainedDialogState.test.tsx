// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { useRetainedDialogState } from '#/web/hooks/useRetainedDialogState.ts'

function Harness() {
  const dialog = useRetainedDialogState<string>()

  return (
    <>
      <button id="open-alpha" type="button" onClick={() => dialog.openWith('alpha')}>
        open alpha
      </button>
      <button id="open-beta" type="button" onClick={() => dialog.openWith('beta')}>
        open beta
      </button>
      <button id="close" type="button" onClick={dialog.close}>
        close
      </button>
      <output id="open">{dialog.open ? 'open' : 'closed'}</output>
      <output id="payload">{dialog.payload ?? ''}</output>
    </>
  )
}

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

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

describe('useRetainedDialogState', () => {
  test('closes without clearing the current payload', () => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    act(() => {
      root!.render(<Harness />)
    })

    click('#open-alpha')
    expect(text('#open')).toBe('open')
    expect(text('#payload')).toBe('alpha')

    click('#close')
    expect(text('#open')).toBe('closed')
    expect(text('#payload')).toBe('alpha')

    click('#open-beta')
    expect(text('#open')).toBe('open')
    expect(text('#payload')).toBe('beta')
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
