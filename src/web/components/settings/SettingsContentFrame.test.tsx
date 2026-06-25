// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { SettingsContentFrame } from '#/web/components/settings/SettingsContentFrame.tsx'

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
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

describe('SettingsContentFrame', () => {
  test('keeps a fixed draggable chrome above the scrollable settings content', () => {
    act(() => {
      root!.render(
        <SettingsContentFrame title="Keyboard" topInset={52}>
          <div>content</div>
        </SettingsContentFrame>,
      )
    })

    const chrome = container?.querySelector<HTMLElement>('.app-drag-region')
    const scrollContent = container?.querySelector<HTMLElement>('.pt-4')
    expect(chrome).not.toBeNull()
    expect(chrome?.style.height).toBe('52px')
    expect(scrollContent?.textContent).toContain('Keyboard')
    expect(scrollContent?.style.paddingTop).toBe('')
  })
})
