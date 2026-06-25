// @vitest-environment jsdom

import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Topbar } from '#/web/components/Topbar.tsx'

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
  vi.clearAllMocks()
})

describe('Topbar', () => {
  test('renders empty-state repo controls on the left and settings on the right', () => {
    const onOpenSettings = vi.fn()

    render(
      <Topbar onOpenSettings={onOpenSettings}>
        <div data-testid="repo-picker" />
      </Topbar>,
    )

    const repoPicker = container?.querySelector('[data-testid="repo-picker"]')
    const settings = settingsButton()
    expect(repoPicker).not.toBeNull()
    expect(settings).not.toBeNull()
    expect(repoPicker?.nextElementSibling).toBe(spacerDiv())
    expect(spacerDiv()?.nextElementSibling).toBe(settings)

    act(() => {
      settings?.click()
    })

    expect(onOpenSettings).toHaveBeenCalledTimes(1)
  })
})

function render(element: ReactNode) {
  act(() => {
    root!.render(element)
  })
}

function settingsButton(): HTMLButtonElement | null {
  return container?.querySelector('button[aria-label="topbar.settings"]') ?? null
}

function spacerDiv(): HTMLDivElement | null {
  return container?.querySelector<HTMLDivElement>('.topbar > .flex-1') ?? null
}
