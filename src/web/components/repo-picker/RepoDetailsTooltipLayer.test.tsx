// @vitest-environment jsdom

import { act } from 'react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { RepoDetailsTooltipLayer } from '#/web/components/repo-picker/RepoDetailsTooltipLayer.tsx'
import type { RepoPickerRepo } from '#/web/components/repo-picker/types.ts'
import { useHostInfoStore } from '#/web/stores/host-info.ts'
import { useI18nStore } from '#/web/stores/i18n.ts'

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  const testWindow = globalThis as typeof globalThis & {
    goblinNative?: unknown
    __GOBLIN_BOOTSTRAP__?: unknown
  }
  testWindow.__GOBLIN_BOOTSTRAP__ = {
    runtime: { kind: 'electron', bridgeVersion: 1, capabilities: [] },
    initialServer: null,
  }
  testWindow.goblinNative = {
    pathForFile: () => '',
    invokeIpc: async () => null,
    abortIpc: async () => true,
    onEvent: () => () => {},
  }
  // Host info moved from the bootstrap to the public `/api/host`
  // endpoint. Seed the store directly so this test doesn't have
  // to mock `fetch` for the tooltip's tilde expansion.
  useHostInfoStore.setState({
    snapshot: { homeDir: '/Users/tester', platform: 'darwin', hostname: 'test', pid: 1 },
    hydrated: true,
  })
  useI18nStore.setState({ lang: 'en', pref: 'auto', dict: {}, hydrated: false })
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  document.body.innerHTML = ''
  const testWindow = globalThis as typeof globalThis & {
    goblinNative?: unknown
    __GOBLIN_BOOTSTRAP__?: unknown
  }
  delete testWindow.goblinNative
  delete testWindow.__GOBLIN_BOOTSTRAP__
  vi.useRealTimers()
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

describe('RepoDetailsTooltipLayer', () => {
  test('shows all remotes in the repo details tooltip', async () => {
    render(
      <RepoDetailsTooltipLayer
        repos={[
          repo('goblin', '/Users/tester/Developer/goblin', [
            {
              name: 'origin',
              fetchUrl: 'https://github.com/nano-props/goblin.git',
              pushUrl: 'https://github.com/nano-props/goblin.git',
            },
            {
              name: 'upstream',
              fetchUrl: 'https://github.com/acme/goblin.git',
              pushUrl: 'git@github.com:acme/goblin.git',
            },
          ]),
        ]}
        delayMs={0}
      >
        <div data-repo-tooltip-id="/Users/tester/Developer/goblin">goblin</div>
      </RepoDetailsTooltipLayer>,
    )

    hoverRepo('/Users/tester/Developer/goblin')
    await flushTimers()

    const text = document.body.textContent ?? ''
    expect(text).toContain('goblin')
    expect(text).toContain('~/Developer/goblin')
    expect(text).toContain('repo-picker.tooltip.last-sync-label')
    expect(text).toContain('repo-picker.tooltip.not-synced')
    expect(text).toContain('origin')
    expect(text).toContain('https://github.com/nano-props/goblin.git')
    expect(text).toContain('upstream')
    expect(text).toContain('https://github.com/acme/goblin.git')
    expect(text).toContain('git@github.com:acme/goblin.git')
  })

  test('shows a no-remotes hint when the repo has no remotes', async () => {
    render(
      <RepoDetailsTooltipLayer repos={[repo('local-only', '/Users/tester/Developer/local-only', [])]} delayMs={0}>
        <div data-repo-tooltip-id="/Users/tester/Developer/local-only">local-only</div>
      </RepoDetailsTooltipLayer>,
    )

    hoverRepo('/Users/tester/Developer/local-only')
    await flushTimers()

    expect(document.body.textContent).toContain('repo-picker.tooltip.no-remotes')
  })

  test('shows the relative last sync time when repo data has refreshed', async () => {
    vi.setSystemTime(new Date('2026-06-20T12:00:00.000Z'))
    render(
      <RepoDetailsTooltipLayer
        repos={[
          {
            ...repo('repo', '/Users/tester/Developer/repo', []),
            lastSyncedAt: Date.parse('2026-06-20T11:58:00.000Z'),
          },
        ]}
        delayMs={0}
      >
        <div data-repo-tooltip-id="/Users/tester/Developer/repo">repo</div>
      </RepoDetailsTooltipLayer>,
    )

    hoverRepo('/Users/tester/Developer/repo')
    await flushTimers()

    const text = document.body.textContent ?? ''
    expect(text).toContain('repo-picker.tooltip.last-sync-label')
    expect(text).toContain('2 minutes ago')
    expect(text).not.toContain('repo-picker.tooltip.not-synced')
  })

  test('uses the provided element as the tooltip root without an extra wrapper', () => {
    render(
      <RepoDetailsTooltipLayer
        repos={[repo('goblin', '/Users/tester/Developer/goblin', [])]}
        className="flex h-full"
        role="group"
      >
        <div data-repo-tooltip-id="/Users/tester/Developer/goblin">goblin</div>
      </RepoDetailsTooltipLayer>,
    )

    expect(container?.firstElementChild?.getAttribute('role')).toBe('group')
    expect(container?.firstElementChild?.className).toContain('h-full')
    expect(
      container?.firstElementChild?.querySelector('[data-repo-tooltip-id="/Users/tester/Developer/goblin"]'),
    ).not.toBeNull()
  })

  test('keeps the tooltip open when the same hovered item is updated in place', async () => {
    const repos = [repo('goblin', '/Users/tester/Developer/goblin', [])]
    render(
      <RepoDetailsTooltipLayer repos={repos} delayMs={0}>
        <div data-repo-tooltip-id="/Users/tester/Developer/goblin">goblin</div>
      </RepoDetailsTooltipLayer>,
    )

    hoverRepo('/Users/tester/Developer/goblin')
    await flushTimers()

    const firstTooltip = document.body.querySelector('[role="tooltip"]')
    expect(firstTooltip?.textContent).toContain('goblin')

    act(() => {
      root!.render(
        <RepoDetailsTooltipLayer repos={[repo('goblin-renamed', '/Users/tester/Developer/goblin', [])]} delayMs={0}>
          <div data-repo-tooltip-id="/Users/tester/Developer/goblin">goblin-renamed</div>
        </RepoDetailsTooltipLayer>,
      )
    })

    const nextTooltip = document.body.querySelector('[role="tooltip"]')
    expect(nextTooltip).not.toBeNull()
    expect(nextTooltip?.textContent).toContain('goblin-renamed')
  })

  test('still shows the tooltip when hover triggers a parent rerender before the delay finishes', async () => {
    function Harness() {
      const [hovered, setHovered] = useState(false)
      return (
        <RepoDetailsTooltipLayer repos={[repo('goblin', '/Users/tester/Developer/goblin', [])]}>
          <div
            data-hovered={hovered ? 'true' : 'false'}
            data-repo-tooltip-id="/Users/tester/Developer/goblin"
            onPointerEnter={() => setHovered(true)}
          >
            goblin
          </div>
        </RepoDetailsTooltipLayer>
      )
    }

    render(<Harness />)

    hoverRepo('/Users/tester/Developer/goblin')
    await flushTimers()

    const tooltip = document.body.querySelector('[role="tooltip"]')
    expect(tooltip).not.toBeNull()
    expect(tooltip?.textContent).toContain('goblin')
  })

  test('keeps the tooltip open when a container leave event fires while the pointer is still inside the strip gap', async () => {
    render(
      <RepoDetailsTooltipLayer repos={[repo('goblin', '/Users/tester/Developer/goblin', [])]} delayMs={0}>
        <div data-repo-tooltip-id="/Users/tester/Developer/goblin">goblin</div>
      </RepoDetailsTooltipLayer>,
    )

    const layer = container?.firstElementChild
    if (!(layer instanceof HTMLElement)) throw new Error('Missing tooltip layer root')
    layer.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 240,
        height: 32,
        right: 240,
        bottom: 32,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect

    hoverRepo('/Users/tester/Developer/goblin')
    await flushTimers()

    expect(document.body.querySelector('[role="tooltip"]')).not.toBeNull()

    act(() => {
      layer.dispatchEvent(new MouseEvent('pointerleave', { bubbles: false, clientX: 150, clientY: 16 }))
    })
    await flushTimers()

    expect(document.body.querySelector('[role="tooltip"]')).not.toBeNull()
  })

  test('hides the tooltip when pointerout leaves the window without a container pointerleave', async () => {
    render(
      <RepoDetailsTooltipLayer repos={[repo('goblin', '/Users/tester/Developer/goblin', [])]} delayMs={0}>
        <div data-repo-tooltip-id="/Users/tester/Developer/goblin">goblin</div>
      </RepoDetailsTooltipLayer>,
    )

    const target = document.body.querySelector('[data-repo-tooltip-id="/Users/tester/Developer/goblin"]')
    if (!(target instanceof HTMLElement)) throw new Error('Missing tooltip target')

    hoverRepo('/Users/tester/Developer/goblin')
    await flushTimers()

    expect(document.body.querySelector('[role="tooltip"]')).not.toBeNull()

    act(() => {
      target.dispatchEvent(new MouseEvent('pointerout', { bubbles: true }))
    })
    await flushTimers()

    expect(document.body.querySelector('[role="tooltip"]')).toBeNull()
  })
})

function repo(name: string, id: string, remoteDetails: RepoPickerRepo['remoteDetails']): RepoPickerRepo {
  return { id, name, remoteDetails, lastSyncedAt: null, lifecycle: null }
}

function render(element: ReactNode) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => {
    root!.render(element)
  })
}

function hoverRepo(id: string) {
  const element = [...document.body.querySelectorAll('[data-repo-tooltip-id]')].find(
    (candidate) => candidate.getAttribute('data-repo-tooltip-id') === id,
  )
  if (!(element instanceof HTMLElement)) throw new Error(`Missing repo target: ${id}`)
  element.getBoundingClientRect = () =>
    ({
      left: 12,
      top: 8,
      width: 120,
      height: 32,
      right: 132,
      bottom: 40,
      x: 12,
      y: 8,
      toJSON: () => ({}),
    }) as DOMRect
  act(() => {
    element.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
  })
}

async function flushTimers() {
  await act(async () => {
    vi.runAllTimers()
    await Promise.resolve()
  })
}
