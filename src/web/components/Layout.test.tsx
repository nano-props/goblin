// @vitest-environment jsdom

import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { CompactRepoWorkspace, RepoWorkspace } from '#/web/components/Layout.tsx'
import { WORKSPACE_PANE_TRANSITION_MS } from '#/web/components/workspace-motion.ts'

vi.mock('#/web/components/SplitPane.tsx', () => ({
  SplitPane: ({ before, after, afterSize }: { before: ReactNode; after: ReactNode; afterSize: number }) => (
    <div data-testid="mock-split-pane" data-after-size={afterSize}>
      {before}
      {after}
    </div>
  ),
}))

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

describe('CompactRepoWorkspace', () => {
  test('marks the inactive pane inert while sharing workspace motion tokens', () => {
    renderCompactWorkspace('navigator')

    expect(compactWorkspace()?.dataset.activePane).toBe('navigator')
    expect(compactWorkspace()?.style.getPropertyValue('--goblin-workspace-pane-transition-duration')).toBe(
      `${WORKSPACE_PANE_TRANSITION_MS}ms`,
    )
    expect(compactPane('navigator')?.getAttribute('aria-hidden')).toBeNull()
    expect(compactPane('navigator')?.hasAttribute('inert')).toBe(false)
    expect(compactPane('workspace')?.getAttribute('aria-hidden')).toBe('true')
    expect(compactPane('workspace')?.hasAttribute('inert')).toBe(true)

    renderCompactWorkspace('workspace')

    expect(compactWorkspace()?.dataset.activePane).toBe('workspace')
    expect(compactPane('navigator')?.getAttribute('aria-hidden')).toBe('true')
    expect(compactPane('navigator')?.hasAttribute('inert')).toBe(true)
    expect(compactPane('workspace')?.getAttribute('aria-hidden')).toBeNull()
    expect(compactPane('workspace')?.hasAttribute('inert')).toBe(false)
  })
})

describe('RepoWorkspace', () => {
  test('defaults the split layout to a 30/70 sidebar/workspace ratio', () => {
    act(() => {
      root!.render(
        <RepoWorkspace branchNavigatorPane={<div>navigator</div>} branchWorkspacePane={<div>workspace</div>} />,
      )
    })

    expect(splitPane()?.dataset.afterSize).toBe('70')
  })
})

function renderCompactWorkspace(activePane: 'navigator' | 'workspace') {
  act(() => {
    root!.render(
      <CompactRepoWorkspace
        activePane={activePane}
        branchNavigatorPane={<button type="button">navigator</button>}
        branchWorkspacePane={<button type="button">workspace</button>}
      />,
    )
  })
}

function compactWorkspace(): HTMLElement | null {
  return container?.querySelector<HTMLElement>('[data-compact-workspace]') ?? null
}

function compactPane(pane: 'navigator' | 'workspace'): HTMLElement | null {
  return container?.querySelector<HTMLElement>(`[data-compact-workspace-pane="${pane}"]`) ?? null
}

function splitPane(): HTMLElement | null {
  return container?.querySelector<HTMLElement>('[data-testid="mock-split-pane"]') ?? null
}
