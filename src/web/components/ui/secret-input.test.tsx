// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, test } from 'vitest'

import { SecretInput } from '#/web/components/ui/secret-input.tsx'

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  document.body.innerHTML = ''
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

describe('SecretInput', () => {
  test('does not render the visibility toggle when empty', () => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    render(<SecretInput value="" onChange={() => {}} showLabel="show" hideLabel="hide" />)

    expect(document.body.querySelector('button[aria-label="show"]')).toBeNull()
  })

  test('toggles between password and text when a value is present', async () => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    render(<SecretInput value="ghp_test" onChange={() => {}} showLabel="show" hideLabel="hide" />)

    const input = document.body.querySelector('input')
    const button = document.body.querySelector('button[aria-label="show"]')
    if (!(input instanceof HTMLInputElement)) throw new Error('Missing input')
    if (!(button instanceof HTMLButtonElement)) throw new Error('Missing toggle button')

    expect(input.type).toBe('password')

    await act(async () => {
      button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      button.click()
    })

    expect(input.type).toBe('text')
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
