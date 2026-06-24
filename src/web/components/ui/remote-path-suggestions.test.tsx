// @vitest-environment jsdom

// Tests for the styled path-suggestions combobox. Covers the cases that
// the previous <datalist>-based UX didn't expose as testable surfaces:
//
//   • the dropdown's suggestion list is rendered into a Popover portal
//     when there's at least one matching suggestion,
//   • keyboard navigation moves a single highlight through the list and
//     commits it on Enter,
//   • clicking a suggestion commits it without blurring the input first,
//   • the host is the sole source of truth for what's shown — this
//     component applies no client-side filter, so the dropdown mirrors
//     whatever the host (i.e. the server, after debounce) supplies.

import { act, useState } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { RemotePathSuggestions } from '#/web/components/ui/remote-path-suggestions.tsx'

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
  document.body.innerHTML = ''
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

describe('RemotePathSuggestions', () => {
  test('does not render the dropdown before any suggestion has landed', async () => {
    render(<Harness suggestions={[]} />)
    await flush()

    expect(input().getAttribute('aria-expanded')).toBe('false')
    expect(document.body.textContent).not.toContain('Suggestions')
  })

  test('opens the dropdown when the input gains focus with suggestions available', async () => {
    render(<Harness suggestions={['/srv/repo', '/srv/other']} />)
    await flush()

    focusInput()
    await flush()

    expect(input().getAttribute('aria-expanded')).toBe('true')
    expect(screenText()).toContain('Suggestions')
    expect(screenText()).toContain('/srv/repo')
    expect(screenText()).toContain('/srv/other')
  })

  test('commits the first suggestion when the user presses Enter', async () => {
    const onChange = vi.fn()
    render(<Harness suggestions={['/srv/repo', '/srv/other']} onChange={onChange} />)
    await flush()

    focusInput()
    await flush()

    pressKey('Enter')

    expect(onChange).toHaveBeenCalledWith('/srv/repo')
  })

  test('ArrowDown advances and ArrowUp at the top wraps to the last entry', async () => {
    const onChange = vi.fn()
    render(<Harness suggestions={['/srv/a', '/srv/b', '/srv/c']} onChange={onChange} />)
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
    render(<Harness suggestions={['/srv/a', '/srv/b', '/srv/c']} onChange={onChange} />)
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

    pressKey('End')
    await flush()
    pressKey('Enter')
    await flush()
    expect(onChange).toHaveBeenLastCalledWith('/srv/c')
  })

  test('scrolls the highlighted option into view when it changes', async () => {
    // jsdom doesn't ship scrollIntoView by default — install a spy
    // directly on the prototype so we can count invocations and
    // inspect the args.
    const scrollSpy = vi.fn()
    const original = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = scrollSpy
    try {
      render(<Harness suggestions={['/srv/a', '/srv/b', '/srv/c']} />)
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
    render(<Harness suggestions={['/srv/repo', '/srv/other']} onChange={onChange} />)
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

  test('shows every suggestion the host provides regardless of typed value', async () => {
    render(<Harness suggestions={['/srv/repo', '/srv/other', '/home/alice']} />)
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
    render(<Harness suggestions={['/srv/a', '/srv/b', '/srv/c']} />)
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
    render(<Harness suggestions={['/srv/a', '/srv/b']} />)
    await flush()

    focusInput()
    await flush()
    expect(input().getAttribute('aria-activedescendant')).not.toBeNull()

    // Radix DismissableLayer (document listener) closes the popover
    // on Escape. The component itself does not handle Escape — this
    // test locks in that contract so a future regression in the
    // DismissableLayer wiring is caught here.
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    await flush()

    expect(input().getAttribute('aria-expanded')).toBe('false')
    expect(input().getAttribute('aria-activedescendant')).toBeNull()
  })

  test('forwards aria-invalid onto the underlying input', async () => {
    render(<Harness suggestions={['/srv/repo']} ariaInvalid />)
    await flush()

    expect(input().getAttribute('aria-invalid')).toBe('true')
  })

  test('shows the empty-state label when the host provides no suggestions at all', async () => {
    render(<Harness suggestions={[]} />)
    await flush()

    focusInput()
    await flush()
    setInputValue('/srv/repo')
    await flush()

    expect(screenText()).toContain('No matching paths')
  })

  test('hides the dropdown when the host marks the input disabled', async () => {
    render(<Harness suggestions={['/srv/repo']} disabled />)
    await flush()

    focusInput()
    await flush()

    expect(document.body.querySelector('[role="listbox"]')).toBeNull()
  })
})

interface HarnessProps {
  suggestions: readonly string[]
  onChange?: (next: string) => void
  disabled?: boolean
  /** Forwarded to the underlying input. */
  ariaInvalid?: boolean
  /** Initial controlled value. Real consumers always drive `value`
   *  from state — exercise the same shape here. */
  initialValue?: string
}

function Harness({ suggestions, onChange = () => {}, disabled, ariaInvalid, initialValue = '' }: HarnessProps) {
  const [value, setValue] = useState(initialValue)
  return (
    <RemotePathSuggestions
      id="rps-test"
      value={value}
      onChange={(next) => {
        setValue(next)
        onChange(next)
      }}
      suggestions={suggestions}
      groupLabel="Suggestions"
      emptyLabel="No matching paths"
      disabled={disabled}
      aria-invalid={ariaInvalid}
    />
  )
}

function render(element: ReactNode) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => {
    root!.render(element)
  })
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
