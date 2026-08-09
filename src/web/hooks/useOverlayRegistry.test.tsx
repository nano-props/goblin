// @vitest-environment jsdom

import { fireEvent } from '@testing-library/vue'
import { describe, expect, test } from 'vitest'
import { defineComponent } from 'vue'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { useOverlayRegistry } from '#/web/hooks/useOverlayRegistry.ts'

const Harness = defineComponent({
  setup() {
    const overlays = useOverlayRegistry(['settings', 'clone', 'openWorkspace'] as const)
    return () => (
      <>
        <button id="open-settings" type="button" onClick={() => overlays.open('settings')}>
          open settings
        </button>
        <button id="set-clone-open" type="button" onClick={() => overlays.setOpen('clone', true)}>
          open clone
        </button>
        <button id="close-settings" type="button" onClick={() => overlays.close('settings')}>
          close settings
        </button>
        <button id="close-all" type="button" onClick={overlays.closeAll}>
          close all
        </button>
        <output id="settings-open">{overlays.state.settings ? 'open' : 'closed'}</output>
        <output id="clone-open">{overlays.state.clone ? 'open' : 'closed'}</output>
        <output id="open-workspace-open">{overlays.state.openWorkspace ? 'open' : 'closed'}</output>
        <output id="any-open">{overlays.anyOpen.value ? 'open' : 'closed'}</output>
      </>
    )
  },
})

describe('useOverlayRegistry', () => {
  test('opens, closes, and closes all overlays generically', async () => {
    const view = renderInJsdom(Harness)

    await fireEvent.click(view.container.querySelector('#open-settings')!)
    await fireEvent.click(view.container.querySelector('#set-clone-open')!)
    expect(text(view.container, '#settings-open')).toBe('open')
    expect(text(view.container, '#clone-open')).toBe('open')
    expect(text(view.container, '#open-workspace-open')).toBe('closed')
    expect(text(view.container, '#any-open')).toBe('open')

    await fireEvent.click(view.container.querySelector('#close-settings')!)
    expect(text(view.container, '#settings-open')).toBe('closed')
    expect(text(view.container, '#clone-open')).toBe('open')

    await fireEvent.click(view.container.querySelector('#close-all')!)
    expect(text(view.container, '#settings-open')).toBe('closed')
    expect(text(view.container, '#clone-open')).toBe('closed')
    expect(text(view.container, '#open-workspace-open')).toBe('closed')
    expect(text(view.container, '#any-open')).toBe('closed')
  })
})

function text(container: Element, selector: string): string {
  return container.querySelector(selector)?.textContent ?? ''
}
