// @vitest-environment jsdom

import { act } from 'react'
import { describe, expect, test } from 'vitest'

import { SecretInput } from '#/web/components/ui/secret-input.tsx'
import { renderInJsdom } from '#/test-utils/render.tsx'

describe('SecretInput', () => {
  test('does not render the visibility toggle when empty', () => {
    const { container } = renderInJsdom(
      <SecretInput value="" onChange={() => {}} showLabel="show" hideLabel="hide" />,
    )

    expect(container.querySelector('button[aria-label="show"]')).toBeNull()
  })

  test('toggles between password and text when a value is present', async () => {
    const { container } = renderInJsdom(
      <SecretInput value="ghp_test" onChange={() => {}} showLabel="show" hideLabel="hide" />,
    )

    const input = container.querySelector('input')
    const button = container.querySelector('button[aria-label="show"]')
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
