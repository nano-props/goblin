import { afterEach, beforeEach, vi } from 'vitest'
import { useFakeTimers } from '#/test-utils/timers.ts'
import { flushTestUpdates, renderInJsdom } from '#/test-utils/render.tsx'
import type { JsdomRenderResult } from '#/test-utils/render.tsx'
import { defineComponent } from 'vue'
import type { VNode } from 'vue'
import { WorkspacePaneTabStrip } from '#/web/components/workspace-pane/WorkspacePaneTabStrip.tsx'
import { WorkspacePaneTabStripScrollMemoryProvider } from '#/web/components/workspace-pane/workspace-pane-tab-strip-scroll-memory.tsx'
import {
  createPendingWorkspacePaneTabItem,
  createRuntimeWorkspacePaneTabItem,
  isRuntimeWorkspacePaneTabItem,
  type WorkspacePaneTabItem,
} from '#/web/components/workspace-pane/workspace-pane-tab-types.ts'
import { terminalWorkspacePaneTabProvider } from '#/web/workspace-pane/tab-providers.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import type { TerminalSessionSummary } from '#/web/components/terminal/types.ts'

// RTL has no reusable harness for tab-strip geometry, scroll memory, and terminal item adaptation.
const testHostEnvironment = globalThis as typeof globalThis & {
  goblinNative?: unknown
  __GOBLIN_BOOTSTRAP__?: unknown
}
const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect
let tabStripViewportRect: DOMRect | null = null
const tabStripTabRects = new Map<string, DOMRect>()
let tabStripNewButtonRect: DOMRect | null = null

beforeEach(() => {
  useFakeTimers()
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    writable: true,
    value(this: HTMLElement) {
      if (this.matches('[data-reka-scroll-area-viewport]') && tabStripViewportRect) return tabStripViewportRect
      if (this.matches('[data-workspace-pane-new-button]') && tabStripNewButtonRect) return tabStripNewButtonRect
      if (this.matches('[data-workspace-pane-tab-scroll-target]')) {
        const tabButton = this.querySelector<HTMLButtonElement>('[role="tab"][id]')
        const rect = tabButton?.id ? tabStripTabRects.get(tabButton.id) : null
        if (rect) return rect
      }
      const rect = this.id ? tabStripTabRects.get(this.id) : null
      return rect ?? originalGetBoundingClientRect.call(this)
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  })
  testHostEnvironment.__GOBLIN_BOOTSTRAP__ = {
    runtime: { kind: 'electron', bridgeVersion: 1, capabilities: [] },
    initialServer: null,
  }
  testHostEnvironment.goblinNative = {
    pathForFile: () => '',
    invokeIpc: async () => null,
    abortIpc: async () => true,
    onEvent: () => () => {},
  }
})

afterEach(() => {
  delete testHostEnvironment.goblinNative
  delete testHostEnvironment.__GOBLIN_BOOTSTRAP__
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    writable: true,
    value: originalGetBoundingClientRect,
  })
  delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView
  tabStripViewportRect = null
  tabStripTabRects.clear()
  tabStripNewButtonRect = null
  // Reset our module-level render handle so the next test that only
  // calls `rerender(...)` (e.g. "restores the full tab strip after
  // leaving compact mode") falls through to `render(...)` instead of
  // trying to rerender a root that `cleanup()` already unmounted.
  lastRender = null
})

interface TestWorkspacePaneTabStripProps {
  terminalFilesystemTargetKey: string
  workspacePaneTabTargetKey?: string
  sessions: TerminalSessionSummary[]
  workspacePaneId: string
  pendingTerminal?: boolean
  responsiveCompact?: boolean
  panelActive?: boolean
  newTerminalBusy?: boolean
  newTerminalBlocksTabInteraction?: boolean
  onNew: () => void
  onSelect: (terminalFilesystemTargetKey: string, tab: TerminalSessionSummary) => void
  onScrollToBottom: (key: string) => void
  onClose: (tab: TerminalSessionSummary) => void
  onReorder: (tabs: WorkspacePaneTabEntry[]) => void
  onNavigateOut?: (direction: 'prev' | 'next' | 'first' | 'last') => void
}

export const TestWorkspacePaneTabStrip = defineComponent<TestWorkspacePaneTabStripProps>({
  name: 'TestWorkspacePaneTabStrip',
  props: [
    'terminalFilesystemTargetKey',
    'workspacePaneTabTargetKey',
    'sessions',
    'workspacePaneId',
    'pendingTerminal',
    'responsiveCompact',
    'panelActive',
    'newTerminalBusy',
    'newTerminalBlocksTabInteraction',
    'onNew',
    'onSelect',
    'onScrollToBottom',
    'onClose',
    'onReorder',
    'onNavigateOut',
  ],

  setup(props) {
    return () => {
      const selected = props.sessions.find((candidate) => candidate.selected) ?? null
      const items: WorkspacePaneTabItem[] = props.sessions.map((tab) =>
        createRuntimeWorkspacePaneTabItem({
          view: tab,
          label: tab.originalTitle ?? tab.fullTitle ?? tab.title,
          tooltip: tab.originalTitle ?? tab.fullTitle ?? tab.title,
          closeLabel: `close ${tab.title}`,
        }),
      )
      if (props.pendingTerminal) {
        items.push(
          createPendingWorkspacePaneTabItem({
            type: 'terminal',
            label: 'terminal.opening',
            tooltip: 'terminal.opening',
          }),
        )
      }
      return (
        <WorkspacePaneTabStrip
          workspacePaneId={props.workspacePaneId}
          responsiveCompact={props.responsiveCompact}
          panelActive={props.panelActive}
          onReorder={props.onReorder}
          onNavigateOut={props.onNavigateOut}
          createAction={
            props.terminalFilesystemTargetKey
              ? {
                  label: 'terminal.new',
                  busy: props.newTerminalBusy ?? false,
                  blocksTabInteraction: props.newTerminalBlocksTabInteraction ?? false,
                  onCreate: props.onNew,
                }
              : null
          }
          workspacePaneTabTargetKey={props.workspacePaneTabTargetKey ?? '/repo\0branch\0main'}
          items={items}
          activeTabIdentity={selected ? terminalWorkspacePaneTabProvider.identity(selected.terminalSessionId) : null}
          onSelect={(item) => {
            if (isRuntimeWorkspacePaneTabItem(item) && item.view.type === 'terminal') {
              props.onSelect(props.terminalFilesystemTargetKey, item.view)
            }
          }}
          onReselect={(item) => {
            if (isRuntimeWorkspacePaneTabItem(item) && item.view.type === 'terminal') {
              props.onScrollToBottom(item.view.terminalSessionId)
            }
          }}
          onClose={(item, presentationEffects) => {
            if (isRuntimeWorkspacePaneTabItem(item) && item.view.type === 'terminal') {
              props.onClose(item.view)
              presentationEffects?.onCommit()
            }
          }}
        />
      )
    }
  },
})

let lastRender: JsdomRenderResult | null = null

export function render(element: VNode): JsdomRenderResult {
  lastRender = renderInJsdom(element, { wrapper: WorkspacePaneTabStripScrollMemoryProvider })
  return lastRender
}

export async function rerender(element: VNode): Promise<JsdomRenderResult> {
  if (!lastRender) return render(element)
  await lastRender.rerender(element)
  return lastRender
}

export function scrollIntoViewMock() {
  return vi.mocked(HTMLElement.prototype.scrollIntoView)
}

export function workspacePaneTabScrollTarget(tabId: string): HTMLElement {
  const tab = document.getElementById(tabId)
  const target = tab?.closest<HTMLElement>('[data-workspace-pane-tab-scroll-target]')
  if (!target) throw new Error(`missing scroll target for ${tabId}`)
  return target
}

export function workspacePaneTabViewport(): HTMLDivElement {
  const viewport = document.body.querySelector<HTMLDivElement>('[data-reka-scroll-area-viewport]')
  if (!viewport) throw new Error('missing workspace pane tab viewport')
  return viewport
}

export function setTabStripScrollGeometry(input: {
  viewport: { left: number; right: number }
  newButton?: { left: number; right: number }
  tabs: Record<string, { left: number; right: number }>
}) {
  tabStripViewportRect = rect(input.viewport)
  tabStripNewButtonRect = input.newButton ? rect(input.newButton) : null
  tabStripTabRects.clear()
  for (const [id, tabRect] of Object.entries(input.tabs)) {
    tabStripTabRects.set(id, rect(tabRect))
  }
}

function rect({ left, right }: { left: number; right: number }): DOMRect {
  const width = right - left
  return {
    left,
    right,
    width,
    x: left,
    top: 0,
    bottom: 28,
    height: 28,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect
}

export function session(overrides: Partial<TerminalSessionSummary> = {}): TerminalSessionSummary {
  const terminalSessionId = overrides.terminalSessionId ?? 'term-111111111111111111111'
  const title = overrides.title ?? 'term-1'
  return {
    type: 'terminal',
    terminalSessionId,
    terminalFilesystemTargetKey: overrides.terminalFilesystemTargetKey ?? '/repo\0/repo/worktree',
    index: overrides.index ?? 1,
    title,
    fullTitle: overrides.fullTitle ?? title,
    originalTitle: overrides.originalTitle ?? title,
    phase: overrides.phase ?? 'open',
    selected: overrides.selected ?? true,
    hasBell: overrides.hasBell ?? false,
    hasRecentOutput: overrides.hasRecentOutput ?? false,
  }
}

export async function flushTimers() {
  await flushTestUpdates(async () => {
    await vi.runAllTimersAsync()
  })
}

export async function openCompactSwitcher(trigger: HTMLButtonElement) {
  await flushTestUpdates(() => {
    trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
  })
}

export function appendTerminalFocusTarget(): HTMLTextAreaElement {
  const host = document.createElement('div')
  host.className = 'goblin-managed-terminal-host'
  const input = document.createElement('textarea')
  host.appendChild(input)
  document.body.appendChild(host)
  return input
}
