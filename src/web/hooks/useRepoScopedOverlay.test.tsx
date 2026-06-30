// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, test } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { useRepoScopedOverlay } from '#/web/hooks/useRepoScopedOverlay.ts'

interface HarnessProps {
  readonly activeRepoId: string | null
  readonly initialRawOpen?: boolean
}

function Harness({ activeRepoId, initialRawOpen = false }: HarnessProps) {
  const [rawOpen, setRawOpen] = useState(initialRawOpen)
  const overlay = useRepoScopedOverlay({ activeRepoId, rawOpen, setRawOpen })

  return (
    <>
      <button id="open" type="button" onClick={overlay.openForActiveRepo}>
        open
      </button>
      <button id="close" type="button" onClick={() => overlay.setOpen(false)}>
        close
      </button>
      <button id="raw-open-button" type="button" onClick={() => setRawOpen(true)}>
        raw open
      </button>
      <output id="raw-open">{rawOpen ? 'open' : 'closed'}</output>
      <output id="open-state">{overlay.state.open ? 'open' : 'closed'}</output>
      <output id="repo-id">{overlay.state.repoId ?? ''}</output>
    </>
  )
}

describe('useRepoScopedOverlay', () => {
  test('does not open without an active repo', () => {
    const { container } = renderInJsdom(<Harness activeRepoId={null} />)

    click(container, '#open')

    expect(text(container, '#raw-open')).toBe('closed')
    expect(text(container, '#open-state')).toBe('closed')
    expect(text(container, '#repo-id')).toBe('')
  })

  test('captures the active repo when opened', () => {
    const { container } = renderInJsdom(<Harness activeRepoId="/repo-a" />)

    click(container, '#open')

    expect(text(container, '#raw-open')).toBe('open')
    expect(text(container, '#open-state')).toBe('open')
    expect(text(container, '#repo-id')).toBe('/repo-a')
  })

  test('closes when the active repo changes while retaining the captured repo id', () => {
    const { container, rerender } = renderInJsdom(<Harness activeRepoId="/repo-a" />)
    click(container, '#open')

    act(() => {
      rerender(<Harness activeRepoId="/repo-b" />)
    })

    expect(text(container, '#raw-open')).toBe('closed')
    expect(text(container, '#open-state')).toBe('closed')
    expect(text(container, '#repo-id')).toBe('/repo-a')
  })

  test('uses the active repo as the target for externally-opened overlays', () => {
    const { container } = renderInJsdom(<Harness activeRepoId="/repo-a" initialRawOpen />)

    expect(text(container, '#raw-open')).toBe('open')
    expect(text(container, '#open-state')).toBe('open')
    expect(text(container, '#repo-id')).toBe('/repo-a')
  })

  test('externally reopening replaces a retained repo id with the current active repo', () => {
    const { container, rerender } = renderInJsdom(<Harness activeRepoId="/repo-a" initialRawOpen />)
    click(container, '#close')
    expect(text(container, '#repo-id')).toBe('/repo-a')

    act(() => {
      rerender(<Harness activeRepoId="/repo-b" />)
    })
    click(container, '#raw-open-button')

    expect(text(container, '#raw-open')).toBe('open')
    expect(text(container, '#open-state')).toBe('open')
    expect(text(container, '#repo-id')).toBe('/repo-b')
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
