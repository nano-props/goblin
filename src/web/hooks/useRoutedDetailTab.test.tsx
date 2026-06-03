// @vitest-environment jsdom

import { act } from 'react'
import { useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { useRoutedDetailTab } from '#/web/hooks/useRoutedDetailTab.ts'
import {
  createBranchSnapshot,
  installGoblinTestBridge,
  resetReposStore,
  seedRepoState,
} from '#/web/stores/repos/test-utils.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { DetailTab } from '#/web/stores/repos/types.ts'

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

function Harness({ initialRouteTab }: { initialRouteTab: DetailTab | null }) {
  const activeId = useReposStore((s) => s.activeId)
  const sessionReady = useReposStore((s) => s.sessionReady)
  const detailTab = useReposStore((s) => (activeId ? (s.repos[activeId]?.ui.detailTab ?? 'status') : 'status'))
  const [routeTab, setRouteTab] = useState<DetailTab | null>(initialRouteTab)
  useRoutedDetailTab({
    currentRepoId: activeId,
    sessionReady,
    routeDetailTab: routeTab,
    onRouteDetailTabChange: setRouteTab,
  })

  return (
    <>
      <button
        id="set-store-changes"
        type="button"
        onClick={() => {
          const state = useReposStore.getState()
          if (state.activeId) state.setDetailTab(state.activeId, 'status')
        }}
      >
        set store status
      </button>
      <output id="route-tab">{routeTab ?? 'none'}</output>
      <output id="store-tab">{detailTab}</output>
    </>
  )
}

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  resetReposStore()
  installGoblinTestBridge({
    'repo.status': () => [],
  })
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

describe('useRoutedDetailTab', () => {
  test('treats valid route detail tabs as the active detail tab authority', async () => {
    seedRepoState({
      id: '/tmp/repo',
      currentBranch: 'main',
      selectedBranch: 'main',
      detailTab: 'status',
      branchSnapshots: [createBranchSnapshot('main', { isCurrent: true, worktree: { path: '/tmp/repo-worktree' } })],
    })

    await render(<Harness initialRouteTab="status" />)

    expect(text('#store-tab')).toBe('status')
    expect(text('#route-tab')).toBe('status')

    await click('#set-store-changes')
    expect(text('#store-tab')).toBe('status')
    expect(text('#route-tab')).toBe('status')
  })

  test('canonicalizes invalid route tabs once session restore is ready', async () => {
    seedRepoState({
      id: '/tmp/repo',
      currentBranch: 'main',
      selectedBranch: 'main',
      detailTab: 'status',
      branchSnapshots: [createBranchSnapshot('main', { isCurrent: true })],
    })

    await render(<Harness initialRouteTab="terminal" />)

    expect(text('#store-tab')).toBe('status')
    expect(text('#route-tab')).toBe('status')
  })

  test('fills a missing route from the restored detail tab once session is ready', async () => {
    seedRepoState({
      id: '/tmp/repo',
      currentBranch: 'main',
      selectedBranch: 'main',
      detailTab: 'terminal',
      branchSnapshots: [createBranchSnapshot('main', { isCurrent: true, worktree: { path: '/tmp/repo-worktree' } })],
    })

    await render(<Harness initialRouteTab={null} />)

    expect(text('#store-tab')).toBe('terminal')
    expect(text('#route-tab')).toBe('terminal')
  })

  test('uses the visible repo instead of store activeId as the route detail tab authority target', async () => {
    const activeRepo = seedRepoState({
      id: '/tmp/repo-a',
      currentBranch: 'main',
      selectedBranch: 'main',
      detailTab: 'status',
      branchSnapshots: [createBranchSnapshot('main', { isCurrent: true, worktree: { path: '/tmp/repo-a-worktree' } })],
    })
    const visibleRepo = {
      ...activeRepo,
      id: '/tmp/repo-b',
      name: 'repo-b',
      instanceToken: activeRepo.instanceToken + 1,
      ui: { ...activeRepo.ui, detailTab: 'status' as DetailTab },
      data: {
        ...activeRepo.data,
        branches: [createBranchSnapshot('main', { isCurrent: true, worktree: { path: '/tmp/repo-b-worktree' } })],
      },
      remote: { ...activeRepo.remote },
      availability: { ...activeRepo.availability },
      cache: { ...activeRepo.cache },
      resources: { ...activeRepo.resources },
      operations: { ...activeRepo.operations },
      events: [...activeRepo.events],
    }
    useReposStore.setState((s) => ({
      ...s,
      repos: {
        [activeRepo.id]: activeRepo,
        [visibleRepo.id]: visibleRepo,
      },
      order: [activeRepo.id, visibleRepo.id],
      activeId: activeRepo.id,
      sessionReady: true,
    }))

    await render(<VisibleRepoHarness initialRouteTab="status" currentRepoId={visibleRepo.id} />)

    expect(text('#current-store-tab')).toBe('status')
    expect(text('#route-tab')).toBe('status')
    expect(text('#active-repo')).toBe(activeRepo.id)
  })
})

function VisibleRepoHarness({
  initialRouteTab,
  currentRepoId,
}: {
  initialRouteTab: DetailTab | null
  currentRepoId: string | null
}) {
  const sessionReady = useReposStore((s) => s.sessionReady)
  const activeId = useReposStore((s) => s.activeId)
  const detailTab = useReposStore((s) =>
    currentRepoId ? (s.repos[currentRepoId]?.ui.detailTab ?? 'status') : 'status',
  )
  const [routeTab, setRouteTab] = useState<DetailTab | null>(initialRouteTab)
  useRoutedDetailTab({
    currentRepoId,
    sessionReady,
    routeDetailTab: routeTab,
    onRouteDetailTabChange: setRouteTab,
  })

  return (
    <>
      <output id="route-tab">{routeTab ?? 'none'}</output>
      <output id="current-store-tab">{detailTab}</output>
      <output id="active-repo">{activeId ?? 'none'}</output>
    </>
  )
}

async function render(element: React.ReactNode) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(element)
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function click(selector: string) {
  const element = container?.querySelector(selector)
  if (!(element instanceof HTMLButtonElement)) throw new Error(`Missing button: ${selector}`)
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await Promise.resolve()
    await Promise.resolve()
  })
}

function text(selector: string): string {
  const element = container?.querySelector(selector)
  if (!(element instanceof HTMLOutputElement)) throw new Error(`Missing output: ${selector}`)
  return element.textContent ?? ''
}
