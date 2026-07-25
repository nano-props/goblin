// @vitest-environment jsdom

import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { WorkspacePaneTabStrip } from '#/web/components/workspace-pane/WorkspacePaneTabStrip.tsx'
import { WorkspacePaneTabStripScrollMemoryProvider } from '#/web/components/workspace-pane/workspace-pane-tab-strip-scroll-memory.tsx'
import { createStaticWorkspacePaneTabItem } from '#/web/components/workspace-pane/workspace-pane-tab-types.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import type { WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'

const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect
const STATIC_TAB_TYPES = ['status', 'files', 'changes', 'history'] satisfies readonly WorkspacePaneStaticTabType[]

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    writable: true,
    value(this: HTMLElement) {
      if (this.matches('[data-radix-scroll-area-viewport]')) return rect(0, 200)
      if (this.querySelector('#workspace-history-tab')) return rect(230, 330)
      return originalGetBoundingClientRect.call(this)
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  })
})

afterEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    writable: true,
    value: originalGetBoundingClientRect,
  })
  delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView
})

describe('workspace pane tab strip scroll memory', () => {
  test('restores the exact position after the tab strip unmounts', () => {
    const result = renderInJsdom(
      <StrictMode>
        <WorkspacePaneTabStripScrollMemoryProvider>
          <TestTabStrip />
        </WorkspacePaneTabStripScrollMemoryProvider>
      </StrictMode>,
    )
    const firstViewport = viewport()
    firstViewport.scrollLeft = 180
    vi.mocked(HTMLElement.prototype.scrollIntoView).mockClear()

    result.rerender(
      <StrictMode>
        <WorkspacePaneTabStripScrollMemoryProvider>
          <div data-testid="workspace-dashboard" />
        </WorkspacePaneTabStripScrollMemoryProvider>
      </StrictMode>,
    )
    result.rerender(
      <StrictMode>
        <WorkspacePaneTabStripScrollMemoryProvider>
          <TestTabStrip />
        </WorkspacePaneTabStripScrollMemoryProvider>
      </StrictMode>,
    )

    const restoredViewport = viewport()
    expect(restoredViewport).not.toBe(firstViewport)
    expect(restoredViewport.scrollLeft).toBe(180)
    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled()
  })

  test('positions a delayed active tab when Strict Mode cleanup records the default position', () => {
    const result = renderInJsdom(
      <StrictMode>
        <WorkspacePaneTabStripScrollMemoryProvider>
          <TestTabStrip active={false} />
        </WorkspacePaneTabStripScrollMemoryProvider>
      </StrictMode>,
    )
    const scrollIntoView = vi.mocked(HTMLElement.prototype.scrollIntoView)
    scrollIntoView.mockClear()

    result.rerender(
      <StrictMode>
        <WorkspacePaneTabStripScrollMemoryProvider>
          <TestTabStrip active />
        </WorkspacePaneTabStripScrollMemoryProvider>
      </StrictMode>,
    )

    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView).toHaveBeenLastCalledWith({ inline: 'end', block: 'nearest', behavior: 'auto' })
  })
})

function TestTabStrip({ active = true }: { active?: boolean }) {
  const items = STATIC_TAB_TYPES.map((type) =>
    createStaticWorkspacePaneTabItem({
      type,
      label: type,
      tooltip: type,
      closeLabel: `close ${type}`,
    }),
  )
  return (
    <WorkspacePaneTabStrip
      workspacePaneTabTargetKey="runtime-1\0workspace-1\0branch\0feature-a"
      items={items}
      workspacePaneId="workspace"
      activeTabIdentity={active ? 'workspace-pane:history' : null}
      panelActive
      onSelect={() => {}}
      onReselect={() => {}}
      onClose={() => {}}
      onReorder={() => {}}
    />
  )
}

function viewport(): HTMLDivElement {
  const element = document.body.querySelector<HTMLDivElement>('[data-radix-scroll-area-viewport]')
  if (!element) throw new Error('missing workspace pane tab viewport')
  return element
}

function rect(left: number, right: number): DOMRect {
  return {
    left,
    right,
    width: right - left,
    x: left,
    top: 0,
    bottom: 28,
    height: 28,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect
}
