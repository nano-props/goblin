// @vitest-environment jsdom

import { describe, expect, test } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { ResizableHandle, ResizablePanelGroup } from '#/web/components/ui/resizable.tsx'

describe('ResizableHandle', () => {
  test('exposes the vertical separator orientation for a horizontal panel layout', () => {
    const { getByRole } = renderInJsdom(
      <ResizablePanelGroup direction="horizontal">
        <div>left</div>
        <ResizableHandle />
        <div>right</div>
      </ResizablePanelGroup>,
    )

    expect(getByRole('separator').getAttribute('aria-orientation')).toBe('vertical')
  })
})
