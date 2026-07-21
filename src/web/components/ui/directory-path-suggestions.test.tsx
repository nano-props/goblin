// @vitest-environment jsdom

// Tests for the styled path-suggestions combobox. Covers the cases that
// the previous <datalist>-based UX didn't expose as testable surfaces:
//
//   • the dropdown's suggestion list is rendered once there's at least
//     one matching suggestion,
//   • keyboard navigation moves a single highlight through the list and
//     commits it on Enter,
//   • clicking a suggestion commits it without blurring the input first,
//   • the host is the sole source of truth for what's shown — this
//     component applies no client-side filter, so the dropdown mirrors
//     whatever the host (i.e. the server, after debounce) supplies.

import { act } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { describe, expect, test, vi } from 'vitest'
import { DirectoryPathSuggestions } from '#/web/components/ui/directory-path-suggestions.tsx'
import { renderInJsdom } from '#/test-utils/render.tsx'

describe('DirectoryPathSuggestions', () => {
  test('does not render the dropdown before any suggestion has landed', async () => {
    render(<Harness suggestions={[]} />)
    await flush()

    expect(input().getAttribute('aria-expanded')).toBe('false')
    // Empty suggestions + empty value: nothing should be rendered into
    // the body — no listbox, no options, no labels.
    expect(document.body.textContent).not.toContain('/srv/repo')
    expect(document.body.querySelector('[role="listbox"]')).toBeNull()
  })

  test('opens the dropdown when the input gains focus with suggestions available', async () => {
    render(<Harness suggestions={['/srv/repo', '/srv/other']} hasFetched />)
    await flush()

    focusInput()
    await flush()

    expect(input().getAttribute('aria-expanded')).toBe('true')
    expect(screenText()).toContain('/srv/repo')
    expect(screenText()).toContain('/srv/other')
  })

  test('commits the first suggestion when the user presses Enter', async () => {
    const onChange = vi.fn()
    render(<Harness suggestions={['/srv/repo', '/srv/other']} onChange={onChange} hasFetched />)
    await flush()

    focusInput()
    await flush()

    pressKey('Enter')

    expect(onChange).toHaveBeenCalledWith('/srv/repo')
  })

  test('lets a second Enter submit the surrounding form after a suggestion commit', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <Harness suggestions={['/srv/repo']} onChange={onChange} hasFetched />
      </form>,
    )
    await flush()

    await user.click(input())
    await user.keyboard('{Enter}')
    await flush()
    expect(onChange).toHaveBeenCalledWith('/srv/repo')
    expect(input().getAttribute('aria-expanded')).toBe('false')

    await user.keyboard('{Enter}')
    await flush()
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  test('ArrowDown advances and ArrowUp at the top wraps to the last entry', async () => {
    const onChange = vi.fn()
    render(<Harness suggestions={['/srv/a', '/srv/b', '/srv/c']} onChange={onChange} hasFetched />)
    await flush()

    focusInput()
    await flush()

    // activeIndex starts at 0; ArrowDown advances to 1 (/srv/b).
    pressKey('ArrowDown')
    await flush()
    pressKey('Enter')
    await flush()

    expect(onChange).toHaveBeenLastCalledWith('/srv/b')

    // Focus is preserved across commit; ArrowUp moves back to index 0.
    pressKey('ArrowUp')
    await flush()
    pressKey('Enter')
    await flush()

    expect(onChange).toHaveBeenLastCalledWith('/srv/a')

    // ArrowUp at index 0 wraps to the last entry (/srv/c).
    pressKey('ArrowUp')
    await flush()
    pressKey('Enter')
    await flush()

    expect(onChange).toHaveBeenLastCalledWith('/srv/c')
  })

  test('Home jumps to the first suggestion and End jumps to the last', async () => {
    const onChange = vi.fn()
    render(<Harness suggestions={['/srv/a', '/srv/b', '/srv/c']} onChange={onChange} hasFetched />)
    await flush()

    focusInput()
    await flush()
    // Move highlight to the middle (index 1) so Home/End have somewhere
    // to jump away from.
    pressKey('ArrowDown')
    await flush()

    pressKey('Home')
    await flush()
    pressKey('Enter')
    await flush()
    expect(onChange).toHaveBeenLastCalledWith('/srv/a')

    pressKey('ArrowDown')
    pressKey('End')
    await flush()
    pressKey('Enter')
    await flush()
    expect(onChange).toHaveBeenLastCalledWith('/srv/c')
  })

  test('resets the active option when a same-length result projection replaces the list', async () => {
    const onChange = vi.fn()
    const { rerender } = render(<Harness suggestions={['/srv/a', '/srv/b']} onChange={onChange} hasFetched />)
    await flush()
    focusInput()
    pressKey('ArrowDown')
    await flush()

    rerender(<Harness suggestions={['/opt/a', '/opt/b']} onChange={onChange} hasFetched />)
    await flush()
    pressKey('Enter')
    await flush()

    expect(onChange).toHaveBeenLastCalledWith('/opt/a')
  })

  test('scrolls the highlighted option into view when it changes', async () => {
    // jsdom doesn't ship scrollIntoView by default — install a spy
    // directly on the prototype so we can count invocations and
    // inspect the args.
    const scrollSpy = vi.fn()
    const original = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = scrollSpy
    try {
      render(<Harness suggestions={['/srv/a', '/srv/b', '/srv/c']} hasFetched />)
      await flush()
      focusInput()
      await flush()

      // Initial render: the active option is index 0; the useLayoutEffect
      // fires once on mount, so the spy may have 0 or 1 calls already
      // depending on React scheduling. Reset before the action under test.
      scrollSpy.mockClear()

      pressKey('ArrowDown')
      await flush()

      expect(scrollSpy).toHaveBeenCalledWith({ block: 'nearest' })
    } finally {
      HTMLElement.prototype.scrollIntoView = original
    }
  })

  test('clicking a suggestion commits it and keeps the input focused', async () => {
    const onChange = vi.fn()
    render(<Harness suggestions={['/srv/repo', '/srv/other']} onChange={onChange} hasFetched />)
    await flush()

    focusInput()
    await flush()

    const row = [...document.body.querySelectorAll('[role="option"]')].find((el) =>
      el.textContent?.includes('/srv/other'),
    )
    if (!row) throw new Error('Missing /srv/other row')
    act(() => {
      row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    await flush()

    expect(onChange).toHaveBeenCalledWith('/srv/other')
    expect(document.activeElement).toBe(input())
  })

  test('pointer movement updates the active suggestion', async () => {
    const onChange = vi.fn()
    render(<Harness suggestions={['/srv/repo', '/srv/other']} onChange={onChange} hasFetched />)
    await flush()

    focusInput()
    await flush()

    const row = [...document.body.querySelectorAll('[role="option"]')].find((el) =>
      el.textContent?.includes('/srv/other'),
    )
    if (!row) throw new Error('Missing /srv/other row')
    act(() => {
      row.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
    })
    await flush()
    pressKey('Enter')
    await flush()

    expect(onChange).toHaveBeenCalledWith('/srv/other')
  })

  test('pointer movement does not scroll the active suggestion into view', async () => {
    const scrollSpy = vi.fn()
    const original = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = scrollSpy
    try {
      render(<Harness suggestions={['/srv/repo', '/srv/other']} hasFetched />)
      await flush()
      focusInput()
      await flush()
      scrollSpy.mockClear()

      const row = [...document.body.querySelectorAll('[role="option"]')].find((el) =>
        el.textContent?.includes('/srv/other'),
      )
      if (!row) throw new Error('Missing /srv/other row')
      act(() => {
        row.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
      })
      await flush()

      expect(scrollSpy).not.toHaveBeenCalled()
    } finally {
      HTMLElement.prototype.scrollIntoView = original
    }
  })

  test('shows every suggestion the host provides regardless of typed value', async () => {
    render(<Harness suggestions={['/srv/repo', '/srv/other', '/home/alice']} hasFetched />)
    await flush()

    focusInput()
    await flush()
    setInputValue('/srv')
    await flush()

    expect(screenText()).toContain('/srv/repo')
    expect(screenText()).toContain('/srv/other')
    // No client-side filter — the host is expected to provide a list
    // already constrained to the typed prefix.
    expect(screenText()).toContain('/home/alice')
  })

  test('points aria-activedescendant at the highlighted option while open', async () => {
    render(<Harness suggestions={['/srv/a', '/srv/b', '/srv/c']} hasFetched />)
    await flush()

    focusInput()
    await flush()
    // activeIndex starts at 0; ArrowDown moves it to 1.
    pressKey('ArrowDown')
    await flush()

    const el = input()
    expect(el.getAttribute('aria-activedescendant')).toBe('rps-test-suggestions-option-1')
    // And the corresponding option really carries that id.
    const target = document.getElementById('rps-test-suggestions-option-1')
    expect(target?.getAttribute('aria-selected')).toBe('true')
  })

  test('drops aria-activedescendant once the dropdown closes via Escape', async () => {
    render(<Harness suggestions={['/srv/a', '/srv/b']} hasFetched />)
    await flush()

    focusInput()
    await flush()
    expect(input().getAttribute('aria-activedescendant')).not.toBeNull()

    pressKey('Escape')
    await flush()

    expect(input().getAttribute('aria-expanded')).toBe('false')
    expect(input().getAttribute('aria-activedescendant')).toBeNull()
  })

  test('consumes Escape only while the suggestion popup is open', async () => {
    const onKeyDown = vi.fn()
    render(
      <div onKeyDown={onKeyDown}>
        <Harness suggestions={['/srv/a']} hasFetched />
      </div>,
    )
    await flush()
    focusInput()
    await flush()

    pressKey('Escape')
    await flush()
    expect(onKeyDown).not.toHaveBeenCalled()
    expect(input().getAttribute('aria-expanded')).toBe('false')

    pressKey('Escape')
    await flush()
    expect(onKeyDown).toHaveBeenCalledTimes(1)
  })

  test('forwards aria-invalid onto the underlying input', async () => {
    render(<Harness suggestions={['/srv/repo']} ariaInvalid hasFetched />)
    await flush()

    expect(input().getAttribute('aria-invalid')).toBe('true')
  })

  test('shows the empty-state label when the host provides no suggestions at all', async () => {
    render(<Harness suggestions={[]} hasFetched />)
    await flush()

    focusInput()
    await flush()
    setInputValue('/srv/repo')
    await flush()

    expect(screenText()).toContain('No matching paths')
    expect(document.querySelector('[role="status"]')?.textContent).toContain('No matching paths')
    expect(document.querySelector('[role="option"]')).toBeNull()
  })

  test('does not show the empty-state label before the first fetch resolves', async () => {
    render(<Harness suggestions={[]} isLoading />)
    await flush()

    focusInput()
    await flush()
    setInputValue('/srv/repo')
    await flush()

    expect(screenText()).not.toContain('No matching paths')
    expect(document.body.querySelector('[role="listbox"]')).toBeNull()
  })

  test('shows a loading spinner in place of the chevron while fetching', async () => {
    render(<Harness suggestions={[]} isLoading />)
    await flush()

    const spinner = document.body.querySelector('svg.animate-spin')
    expect(spinner).not.toBeNull()
    expect(input().getAttribute('aria-expanded')).toBe('false')
  })

  test('hides the dropdown when the host marks the input disabled', async () => {
    render(<Harness suggestions={['/srv/repo']} disabled hasFetched />)
    await flush()

    focusInput()
    await flush()

    expect(document.body.querySelector('[role="listbox"]')).toBeNull()
  })

  test('re-focusing the input after blur reopens the dropdown without flickering closed', async () => {
    render(
      <>
        <button type="button" id="outside-focus-target">
          outside
        </button>
        <Harness suggestions={['/srv/repo', '/srv/other']} hasFetched />
      </>,
    )
    await flush()

    // Open, then move focus outside so the dropdown dismisses.
    focusInput()
    await flush()
    expect(input().getAttribute('aria-expanded')).toBe('true')

    focusOutside()
    await flush()
    expect(input().getAttribute('aria-expanded')).toBe('false')

    focusInput()
    await flush()

    expect(input().getAttribute('aria-expanded')).toBe('true')
    expect(screenText()).toContain('/srv/repo')
  })

  test('re-focusing the input after blur reopens the empty-state dropdown', async () => {
    render(
      <>
        <button type="button" id="outside-focus-target">
          outside
        </button>
        <Harness suggestions={[]} hasFetched />
      </>,
    )
    await flush()

    focusInput()
    await flush()
    setInputValue('/srv/repo')
    await flush()
    expect(screenText()).toContain('No matching paths')

    focusOutside()
    await flush()
    expect(input().getAttribute('aria-expanded')).toBe('false')

    focusInput()
    await flush()

    expect(input().getAttribute('aria-expanded')).toBe('true')
    expect(screenText()).toContain('No matching paths')
  })
})

interface HarnessProps {
  suggestions: readonly string[]
  onChange?: (next: string) => void
  disabled?: boolean
  isLoading?: boolean
  hasFetched?: boolean
  /** Forwarded to the underlying input. */
  ariaInvalid?: boolean
}

function Harness({ suggestions, onChange = () => {}, disabled, isLoading, hasFetched, ariaInvalid }: HarnessProps) {
  const [value, setValue] = useState('')
  return (
    <DirectoryPathSuggestions
      id="rps-test"
      value={value}
      onChange={(next) => {
        setValue(next)
        onChange(next)
      }}
      suggestions={suggestions}
      isLoading={isLoading}
      hasFetched={hasFetched}
      emptyLabel="No matching paths"
      disabled={disabled}
      aria-invalid={ariaInvalid}
    />
  )
}

function render(element: ReactNode) {
  return renderInJsdom(element)
}

function input(): HTMLInputElement {
  const element = document.querySelector('#rps-test')
  if (!(element instanceof HTMLInputElement)) throw new Error('Missing input #rps-test')
  return element
}

function focusInput() {
  act(() => {
    input().focus()
  })
}

function focusOutside() {
  const target = document.querySelector('#outside-focus-target')
  if (!(target instanceof HTMLButtonElement)) throw new Error('Missing outside focus target')
  act(() => {
    target.focus()
  })
}

function setInputValue(value: string) {
  const element = input()
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
  descriptor?.set?.call(element, value)
  act(() => {
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function pressKey(key: string) {
  act(() => {
    input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  })
}

function screenText(): string {
  return document.body.textContent ?? ''
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}
