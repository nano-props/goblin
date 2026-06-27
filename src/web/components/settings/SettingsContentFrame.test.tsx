// @vitest-environment jsdom

import { describe, expect, test } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { SettingsContentFrame } from '#/web/components/settings/SettingsContentFrame.tsx'

describe('SettingsContentFrame', () => {
  test('keeps a fixed draggable chrome above the scrollable settings content', () => {
    const { container } = renderInJsdom(
      <SettingsContentFrame title="Keyboard" topInset={52}>
        <div>content</div>
      </SettingsContentFrame>,
    )

    const chrome = container.querySelector<HTMLElement>('.app-drag-region')
    const scrollContent = container.querySelector<HTMLElement>('.pt-4')
    expect(chrome).not.toBeNull()
    expect(chrome?.style.height).toBe('52px')
    expect(scrollContent?.textContent).toContain('Keyboard')
    expect(scrollContent?.style.paddingTop).toBe('')
  })
})
