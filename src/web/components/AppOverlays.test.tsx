// @vitest-environment jsdom

import { screen } from '@testing-library/vue'
import { describe, expect, test, vi } from 'vitest'
import { defineComponent } from 'vue'
import { TITLE_BAR_HEIGHT_PX } from '#/shared/title-bar-chrome.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { AppGlobalOverlays } from '#/web/components/AppOverlays.tsx'
import { useAppOverlays } from '#/web/hooks/useAppOverlays.ts'

vi.mock('#/web/components/BranchActionDialogHost.tsx', () => ({ BranchActionDialogHost: () => null }))
vi.mock('#/web/components/FiletreeActionDialogHost.tsx', () => ({ FiletreeActionDialogHost: () => null }))
vi.mock('#/web/components/OpenRemoteWorkspaceDialog.tsx', () => ({ OpenRemoteWorkspaceDialog: () => null }))
vi.mock('#/web/components/RepoCloneDialog.tsx', () => ({ RepoCloneDialog: () => null }))
vi.mock('#/web/components/TerminalActionDialogHost.tsx', () => ({ TerminalActionDialogHost: () => null }))
vi.mock('#/web/components/WorkspaceDropOverlay.tsx', () => ({ WorkspaceDropOverlay: () => null }))
vi.mock('#/web/components/WorkspaceOpenDialog.tsx', () => ({ WorkspaceOpenDialog: () => null }))
vi.mock('#/web/components/ui/sonner.tsx', () => {
  function Toaster(props: {
    position: string
    containerAriaLabel: string
    offset: { top: number }
    mobileOffset: { top: number }
  }) {
    return (
      <div
        data-testid="toaster"
        data-position={props.position}
        data-container-aria-label={props.containerAriaLabel}
        data-top-offset={props.offset.top}
        data-mobile-top-offset={props.mobileOffset.top}
      />
    )
  }
  Toaster.props = ['position', 'containerAriaLabel', 'offset', 'mobileOffset']
  return { Toaster }
})

const Harness = defineComponent({
  setup() {
    const overlays = useAppOverlays()
    return () => <AppGlobalOverlays overlays={overlays} />
  },
})

describe('AppGlobalOverlays', () => {
  test('configures desktop and mobile top offsets below Electron chrome', () => {
    renderInJsdom(<Harness />)

    const toaster = screen.getByTestId('toaster')
    const expectedOffset = String(TITLE_BAR_HEIGHT_PX + 12)
    expect(toaster.dataset.position).toBe('bottom-right')
    expect(toaster.dataset.containerAriaLabel).toBe('app-chrome.notifications')
    expect(toaster.dataset.topOffset).toBe(expectedOffset)
    expect(toaster.dataset.mobileTopOffset).toBe(expectedOffset)
  })
})
