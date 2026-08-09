// @vitest-environment jsdom

import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { VNode } from 'vue'
import { flushTestUpdates, renderInJsdom } from '#/test-utils/render.tsx'
import { WorkspacePaneTabStrip } from '#/web/components/workspace-pane/WorkspacePaneTabStrip.tsx'
import { WorkspacePaneTabStripScrollMemoryProvider } from '#/web/components/workspace-pane/workspace-pane-tab-strip-scroll-memory.tsx'
import { createStaticWorkspacePaneTabItem } from '#/web/components/workspace-pane/workspace-pane-tab-types.ts'
import type { WorkspacePaneTabItem } from '#/web/components/workspace-pane/workspace-pane-tab-types.ts'
import type { WorkspacePaneTabClosePresentationEffects } from '#/web/workspace-pane/workspace-pane-tab-close-presentation.ts'

const originalIntersectionObserver = globalThis.IntersectionObserver
const originalMatchMedia = window.matchMedia

beforeEach(() => {
  window.matchMedia = (query) => ({
    matches: true,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  })
  globalThis.IntersectionObserver = class TestIntersectionObserver implements IntersectionObserver {
    readonly root = null
    readonly rootMargin = '0px'
    readonly scrollMargin = '0px'
    readonly thresholds = []

    disconnect(): void {}
    observe(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return []
    }
    unobserve(): void {}
  }
  Object.defineProperty(Document.prototype, 'getAnimations', {
    configurable: true,
    value: () => [],
  })
  Object.defineProperty(Element.prototype, 'getAnimations', {
    configurable: true,
    value: () => [],
  })
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: vi.fn(),
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  })
})

afterEach(() => {
  window.matchMedia = originalMatchMedia
  globalThis.IntersectionObserver = originalIntersectionObserver
  Reflect.deleteProperty(Document.prototype, 'getAnimations')
  Reflect.deleteProperty(Element.prototype, 'getAnimations')
  Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture')
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
})

describe('WorkspacePaneTabStrip pointer selection', () => {
  test('keeps a zero-distance pointer click available for tab selection', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const status = staticTab('status', 'Status')
    const files = staticTab('files', 'Files')
    const rendered = renderInJsdom(
      <WorkspacePaneTabStrip
        workspacePaneTabTargetKey="workspace\0branch\0main"
        items={[status, files]}
        workspacePaneId="workspace"
        activeTabIdentity={status.identity}
        panelActive
        onSelect={onSelect}
        onReselect={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
      { wrapper: WorkspacePaneTabStripScrollMemoryProvider },
    )

    const filesTab = rendered.getByRole('tab', { name: 'Files' })
    await vi.waitFor(() => expect(filesTab.getAttribute('aria-describedby')).toMatch(/^dnd-kit-description-/))

    expect(filesTab.getAttribute('aria-roledescription')).toBe('sortable')
    expect(filesTab.hasAttribute('aria-pressed')).toBe(false)
    expect(filesTab.hasAttribute('aria-grabbed')).toBe(false)

    await user.click(filesTab)

    expect(onSelect).toHaveBeenCalledOnce()
    expect(onSelect).toHaveBeenCalledWith(files)
  })

  test('keeps tab ARIA valid throughout a keyboard drag', async () => {
    const status = staticTab('status', 'Status')
    const files = staticTab('files', 'Files')
    const rendered = renderInJsdom(
      <WorkspacePaneTabStrip
        workspacePaneTabTargetKey="workspace\0branch\0main"
        items={[status, files]}
        workspacePaneId="workspace"
        activeTabIdentity={status.identity}
        panelActive
        onSelect={() => {}}
        onReselect={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
      { wrapper: WorkspacePaneTabStripScrollMemoryProvider },
    )

    const statusTab = rendered.getByRole('tab', { name: 'Status' })
    await rendered.flushAnimationFrames()
    statusTab.focus()
    statusTab.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, code: 'Space', key: ' ' }))
    await vi.waitFor(() =>
      expect(document.querySelector('[role="status"]')?.textContent).toContain('Picked up draggable item'),
    )

    await vi.waitFor(() => expect(statusTab.hasAttribute('aria-pressed')).toBe(false))
    expect(statusTab.getAttribute('aria-roledescription')).toBe('sortable')
    expect(statusTab.hasAttribute('aria-grabbed')).toBe(false)

    statusTab.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, code: 'Escape', key: 'Escape' }),
    )
  })
})

describe('WorkspacePaneTabStrip close focus ownership', () => {
  test('waits through the removed-tab projection until the next active tab is authoritative', async () => {
    const status = staticTab('status', 'Status')
    const files = staticTab('files', 'Files')
    let closeEffects: WorkspacePaneTabClosePresentationEffects | null = null
    const onClose = vi.fn(
      (_item: WorkspacePaneTabItem, presentationEffects: WorkspacePaneTabClosePresentationEffects | null) => {
        closeEffects = presentationEffects
      },
    )
    const rendered = renderInJsdom(tabStrip({ items: [status, files], activeTabIdentity: files.identity, onClose }), {
      wrapper: WorkspacePaneTabStripScrollMemoryProvider,
    })

    const filesTab = rendered.getByRole('tab', { name: 'Files' })
    filesTab.focus()
    await flushTestUpdates(() => rendered.getByTitle('Close Files').click())

    await rendered.rerender(tabStrip({ items: [status], activeTabIdentity: null, onClose }))
    expect(document.activeElement).toBe(document.body)

    await flushTestUpdates(() => requireClosePresentationEffects(closeEffects).onCommit())
    expect(document.activeElement).toBe(document.body)

    await rendered.rerender(tabStrip({ items: [status], activeTabIdentity: status.identity, onClose }))
    expect(document.activeElement).toBe(rendered.getByRole('tab', { name: 'Status' }))
  })

  test('hands Delete focus from a focused tab whose active projection has not caught up', async () => {
    const user = userEvent.setup()
    const status = staticTab('status', 'Status')
    const files = staticTab('files', 'Files')
    const onClose = vi.fn(
      (_item: WorkspacePaneTabItem, presentationEffects: WorkspacePaneTabClosePresentationEffects | null) =>
        presentationEffects?.onCommit(),
    )
    const rendered = renderInJsdom(tabStrip({ items: [status, files], activeTabIdentity: status.identity, onClose }), {
      wrapper: WorkspacePaneTabStripScrollMemoryProvider,
    })

    rendered.getByRole('tab', { name: 'Files' }).focus()
    await user.keyboard('{Delete}')

    expect(onClose).toHaveBeenCalledOnce()
    expect(onClose.mock.calls[0]?.[0]).toBe(files)
    expect(document.activeElement).toBe(rendered.getByRole('tab', { name: 'Files' }))
    await rendered.rerender(tabStrip({ items: [status], activeTabIdentity: status.identity, onClose }))
    expect(document.activeElement).toBe(rendered.getByRole('tab', { name: 'Status' }))
  })

  test('hands pointer-close focus from a focused tab whose active projection has not caught up', async () => {
    const user = userEvent.setup()
    const status = staticTab('status', 'Status')
    const files = staticTab('files', 'Files')
    const onClose = vi.fn(
      (_item: WorkspacePaneTabItem, presentationEffects: WorkspacePaneTabClosePresentationEffects | null) =>
        presentationEffects?.onCommit(),
    )
    const rendered = renderInJsdom(tabStrip({ items: [status, files], activeTabIdentity: status.identity, onClose }), {
      wrapper: WorkspacePaneTabStripScrollMemoryProvider,
    })

    await user.click(rendered.getByTitle('Close Files'))

    expect(onClose).toHaveBeenCalledOnce()
    expect(onClose.mock.calls[0]?.[0]).toBe(files)
    expect(document.activeElement).toBe(rendered.getByRole('tab', { name: 'Files' }))
    await rendered.rerender(tabStrip({ items: [status], activeTabIdentity: status.identity, onClose }))
    expect(document.activeElement).toBe(rendered.getByRole('tab', { name: 'Status' }))
  })

  test('clears the handoff when the last tab closes', async () => {
    const status = staticTab('status', 'Status')
    const files = staticTab('files', 'Files')
    const onClose = vi.fn(
      (_item: WorkspacePaneTabItem, presentationEffects: WorkspacePaneTabClosePresentationEffects | null) =>
        presentationEffects?.onCommit(),
    )
    const rendered = renderInJsdom(tabStrip({ items: [status], activeTabIdentity: status.identity, onClose }), {
      wrapper: WorkspacePaneTabStripScrollMemoryProvider,
    })

    rendered.getByRole('tab', { name: 'Status' }).focus()
    await flushTestUpdates(() => rendered.getByTitle('Close Status').click())
    await rendered.rerender(tabStrip({ items: [], activeTabIdentity: null, onClose }))
    expect(document.activeElement).toBe(document.body)

    await rendered.rerender(tabStrip({ items: [files], activeTabIdentity: files.identity, onClose }))
    expect(document.activeElement).not.toBe(rendered.getByRole('tab', { name: 'Files' }))
  })

  test('clears a failed handoff before a later active-tab change', async () => {
    const status = staticTab('status', 'Status')
    const files = staticTab('files', 'Files')
    let closeEffects: WorkspacePaneTabClosePresentationEffects | null = null
    const onClose = vi.fn(
      (_item: WorkspacePaneTabItem, presentationEffects: WorkspacePaneTabClosePresentationEffects | null) => {
        closeEffects = presentationEffects
      },
    )
    const rendered = renderInJsdom(tabStrip({ items: [status, files], activeTabIdentity: status.identity, onClose }), {
      wrapper: WorkspacePaneTabStripScrollMemoryProvider,
    })

    const statusTab = rendered.getByRole('tab', { name: 'Status' })
    statusTab.focus()
    await flushTestUpdates(() => rendered.getByTitle('Close Status').click())
    await flushTestUpdates(() => requireClosePresentationEffects(closeEffects).onAbandon())
    await rendered.rerender(tabStrip({ items: [status, files], activeTabIdentity: files.identity, onClose }))

    expect(document.activeElement).toBe(statusTab)
    expect(document.activeElement).not.toBe(rendered.getByRole('tab', { name: 'Files' }))
  })

  test('clears a pending handoff when the tab target changes', async () => {
    const status = staticTab('status', 'Status')
    const files = staticTab('files', 'Files')
    let closeEffects: WorkspacePaneTabClosePresentationEffects | null = null
    const onClose = vi.fn(
      (_item: WorkspacePaneTabItem, presentationEffects: WorkspacePaneTabClosePresentationEffects | null) => {
        closeEffects = presentationEffects
      },
    )
    const rendered = renderInJsdom(tabStrip({ items: [status, files], activeTabIdentity: files.identity, onClose }), {
      wrapper: WorkspacePaneTabStripScrollMemoryProvider,
    })

    const filesTab = rendered.getByRole('tab', { name: 'Files' })
    filesTab.focus()
    await flushTestUpdates(() => rendered.getByTitle('Close Files').click())
    filesTab.blur()
    await rendered.rerender(
      tabStrip({
        targetKey: 'workspace\0branch\0other',
        items: [status],
        activeTabIdentity: status.identity,
        onClose,
      }),
    )
    await flushTestUpdates(() => requireClosePresentationEffects(closeEffects).onCommit())

    expect(document.activeElement).toBe(document.body)
  })

  test('makes a close handoff inert when its tab strip unmounts', async () => {
    const status = staticTab('status', 'Status')
    const files = staticTab('files', 'Files')
    let closeEffects: WorkspacePaneTabClosePresentationEffects | null = null
    const onClose = vi.fn(
      (_item: WorkspacePaneTabItem, presentationEffects: WorkspacePaneTabClosePresentationEffects | null) => {
        closeEffects = presentationEffects
      },
    )
    const rendered = renderInJsdom(tabStrip({ items: [status, files], activeTabIdentity: files.identity, onClose }), {
      wrapper: WorkspacePaneTabStripScrollMemoryProvider,
    })

    rendered.getByRole('tab', { name: 'Files' }).focus()
    await flushTestUpdates(() => rendered.getByTitle('Close Files').click())
    rendered.unmount()
    const externalButton = document.createElement('button')
    document.body.append(externalButton)
    externalButton.focus()

    await flushTestUpdates(() => requireClosePresentationEffects(closeEffects).onCommit())

    expect(document.activeElement).toBe(externalButton)
    externalButton.remove()
  })

  test('lets a newer close handoff supersede an older asynchronous result', async () => {
    const status = staticTab('status', 'Status')
    const files = staticTab('files', 'Files')
    let filesCloseEffects: WorkspacePaneTabClosePresentationEffects | null = null
    let statusCloseEffects: WorkspacePaneTabClosePresentationEffects | null = null
    const onClose = vi.fn(
      (item: WorkspacePaneTabItem, presentationEffects: WorkspacePaneTabClosePresentationEffects | null) => {
        if (item.identity === files.identity) filesCloseEffects = presentationEffects
        else statusCloseEffects = presentationEffects
      },
    )
    const rendered = renderInJsdom(tabStrip({ items: [status, files], activeTabIdentity: files.identity, onClose }), {
      wrapper: WorkspacePaneTabStripScrollMemoryProvider,
    })

    rendered.getByRole('tab', { name: 'Files' }).focus()
    await flushTestUpdates(() => rendered.getByTitle('Close Files').click())
    rendered.getByRole('tab', { name: 'Status' }).focus()
    await flushTestUpdates(() => rendered.getByTitle('Close Status').click())
    await rendered.rerender(tabStrip({ items: [files], activeTabIdentity: files.identity, onClose }))

    await flushTestUpdates(() => requireClosePresentationEffects(filesCloseEffects).onCommit())
    expect(document.activeElement).toBe(document.body)

    await flushTestUpdates(() => requireClosePresentationEffects(statusCloseEffects).onCommit())
    expect(document.activeElement).toBe(rendered.getByRole('tab', { name: 'Files' }))
  })
})

interface TabStripInput {
  targetKey?: string
  items: WorkspacePaneTabItem[]
  activeTabIdentity: string | null
  onClose: (item: WorkspacePaneTabItem, presentationEffects: WorkspacePaneTabClosePresentationEffects | null) => void
}

function tabStrip(input: TabStripInput): VNode {
  return (
    <WorkspacePaneTabStrip
      workspacePaneTabTargetKey={input.targetKey ?? 'workspace\0branch\0main'}
      items={input.items}
      workspacePaneId="workspace"
      activeTabIdentity={input.activeTabIdentity}
      panelActive
      onSelect={() => {}}
      onReselect={() => {}}
      onClose={input.onClose}
      onReorder={() => {}}
    />
  )
}

function staticTab(type: 'status' | 'files', label: string) {
  return createStaticWorkspacePaneTabItem({
    type,
    label,
    tooltip: label,
    closeLabel: `Close ${label}`,
  })
}

function requireClosePresentationEffects(
  effects: WorkspacePaneTabClosePresentationEffects | null,
): WorkspacePaneTabClosePresentationEffects {
  if (!effects) throw new Error('expected tab close presentation effects')
  return effects
}
