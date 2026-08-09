// @vitest-environment jsdom

import { fireEvent } from '@testing-library/vue'
import { beforeEach, describe, expect, test } from 'vitest'
import { defineComponent, ref } from 'vue'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { useAppOverlays } from '#/web/hooks/useAppOverlays.ts'
import type { AppOverlayKey } from '#/web/hooks/useAppOverlays.ts'
import { resetWorkspacesStore } from '#/web/test-utils/repo-store.ts'

const Harness = defineComponent({
  setup() {
    const overlays = useAppOverlays()
    return () => <OverlayHarnessView overlays={overlays} />
  },
})

const RoutedHarness = defineComponent({
  setup() {
    const overlay = ref<AppOverlayKey | null>(null)
    const overlays = useAppOverlays({
      routeOverlay: overlay,
      onRouteOverlayChange: (nextOverlay) => {
        overlay.value = nextOverlay
      },
    })
    return () => <OverlayHarnessView overlays={overlays} />
  },
})

function OverlayHarnessView({ overlays }: { overlays: ReturnType<typeof useAppOverlays> }) {
  return (
    <>
      <button id="open-clone" type="button" onClick={overlays.openCloneRepo}>
        open clone
      </button>
      <button id="open-workspace" type="button" onClick={overlays.openWorkspacePathDialog}>
        open repo
      </button>
      <button id="close-all" type="button" onClick={overlays.closeAllOverlays}>
        close all
      </button>
      <output id="clone-open">{overlays.state.value.clone.open ? 'open' : 'closed'}</output>
      <output id="open-workspace-open">{overlays.state.value.openWorkspace.open ? 'open' : 'closed'}</output>
      <output id="any-open">{overlays.anyOpen.value ? 'open' : 'closed'}</output>
    </>
  )
}

beforeEach(resetWorkspacesStore)

describe('useAppOverlays', () => {
  test.each([Harness, RoutedHarness])('opens and closes app overlays through one owner', async (component) => {
    const view = renderInJsdom(component)

    await fireEvent.click(view.container.querySelector('#open-clone')!)
    expect(text(view.container, '#clone-open')).toBe('open')
    expect(text(view.container, '#any-open')).toBe('open')

    await fireEvent.click(view.container.querySelector('#open-workspace')!)
    expect(text(view.container, '#open-workspace-open')).toBe('open')

    await fireEvent.click(view.container.querySelector('#close-all')!)
    expect(text(view.container, '#clone-open')).toBe('closed')
    expect(text(view.container, '#open-workspace-open')).toBe('closed')
    expect(text(view.container, '#any-open')).toBe('closed')
  })
})

function text(container: Element, selector: string): string {
  return container.querySelector(selector)?.textContent ?? ''
}
