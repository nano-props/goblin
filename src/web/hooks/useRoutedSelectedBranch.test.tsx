// @vitest-environment jsdom

import { act } from 'react'
import { useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { useRoutedSelectedBranch } from '#/web/hooks/useRoutedSelectedBranch.ts'
import {
  createBranchSnapshot,
  installGoblinTestBridge,
  resetReposStore,
  seedRepoState,
} from '#/web/stores/repos/test-utils.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

function Harness({ initialRouteBranch }: { initialRouteBranch: string | null }) {
  const activeId = useReposStore((s) => s.activeId)
  const sessionReady = useReposStore((s) => s.sessionReady)
  const selectedBranch = useReposStore((s) => (activeId ? (s.repos[activeId]?.ui.selectedBranch ?? null) : null))
  const [routeBranch, setRouteBranch] = useState<string | null>(initialRouteBranch)
  useRoutedSelectedBranch({
    currentRepoId: activeId,
    sessionReady,
    routeBranch,
    onRouteBranchChange: setRouteBranch,
  })

  return (
    <>
      <button
        id="set-store-branch-main"
        type="button"
        onClick={() => {
          const state = useReposStore.getState()
          if (state.activeId) state.selectBranch(state.activeId, 'main')
        }}
      >
        set store branch main
      </button>
      <output id="route-branch">{routeBranch ?? 'none'}</output>
      <output id="store-branch">{selectedBranch ?? 'none'}</output>
    </>
  )
}

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  resetReposStore()
  installGoblinTestBridge({
    'repo.status': () => [],
    'repo.pullRequests': () => [],
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

describe('useRoutedSelectedBranch', () => {
  test('treats valid route branches as the selected branch authority', async () => {
    seedRepoState({
      id: '/tmp/repo',
      currentBranch: 'main',
      selectedBranch: 'main',
      branchSnapshots: [
        createBranchSnapshot('main', { isCurrent: true, worktree: { path: '/tmp/repo-worktree' } }),
        createBranchSnapshot('feature/test'),
      ],
    })

    await render(<Harness initialRouteBranch="feature/test" />)

    expect(text('#store-branch')).toBe('feature/test')
    expect(text('#route-branch')).toBe('feature/test')

    await click('#set-store-branch-main')
    expect(text('#store-branch')).toBe('feature/test')
    expect(text('#route-branch')).toBe('feature/test')
  })

  test('drops missing route branches once session restore is ready', async () => {
    seedRepoState({
      id: '/tmp/repo',
      currentBranch: 'main',
      selectedBranch: 'feature/test',
      branchSnapshots: [
        createBranchSnapshot('main', { isCurrent: true, worktree: { path: '/tmp/repo-worktree' } }),
        createBranchSnapshot('feature/test'),
      ],
    })

    await render(<Harness initialRouteBranch="missing" />)

    expect(text('#store-branch')).toBe('feature/test')
    expect(text('#route-branch')).toBe('feature/test')
  })

  test('fills a missing route from the restored selected branch once session is ready', async () => {
    seedRepoState({
      id: '/tmp/repo',
      currentBranch: 'main',
      selectedBranch: 'feature/test',
      branchSnapshots: [
        createBranchSnapshot('main', { isCurrent: true, worktree: { path: '/tmp/repo-worktree' } }),
        createBranchSnapshot('feature/test'),
      ],
    })

    await render(<Harness initialRouteBranch={null} />)

    expect(text('#store-branch')).toBe('feature/test')
    expect(text('#route-branch')).toBe('feature/test')
  })

  test('uses the visible repo instead of store activeId as the route branch authority target', async () => {
    const activeRepo = seedRepoState({
      id: '/tmp/repo-a',
      currentBranch: 'main',
      selectedBranch: 'main',
      branchSnapshots: [
        createBranchSnapshot('main', { isCurrent: true, worktree: { path: '/tmp/repo-a-worktree' } }),
        createBranchSnapshot('feature/a'),
      ],
    })
    const visibleRepo = {
      ...activeRepo,
      id: '/tmp/repo-b',
      name: 'repo-b',
      instanceToken: activeRepo.instanceToken + 1,
      ui: { ...activeRepo.ui, selectedBranch: 'main' },
      data: {
        ...activeRepo.data,
        branches: [
          createBranchSnapshot('main', { isCurrent: true, worktree: { path: '/tmp/repo-b-worktree' } }),
          createBranchSnapshot('feature/b'),
        ],
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

    await render(<VisibleRepoHarness initialRouteBranch="feature/b" currentRepoId={visibleRepo.id} />)

    expect(text('#current-store-branch')).toBe('feature/b')
    expect(text('#route-branch')).toBe('feature/b')
    expect(text('#active-repo')).toBe(activeRepo.id)
  })
})

function VisibleRepoHarness({
  initialRouteBranch,
  currentRepoId,
}: {
  initialRouteBranch: string | null
  currentRepoId: string | null
}) {
  const sessionReady = useReposStore((s) => s.sessionReady)
  const activeId = useReposStore((s) => s.activeId)
  const selectedBranch = useReposStore((s) =>
    currentRepoId ? (s.repos[currentRepoId]?.ui.selectedBranch ?? null) : null,
  )
  const [routeBranch, setRouteBranch] = useState<string | null>(initialRouteBranch)
  useRoutedSelectedBranch({
    currentRepoId,
    sessionReady,
    routeBranch,
    onRouteBranchChange: setRouteBranch,
  })

  return (
    <>
      <output id="route-branch">{routeBranch ?? 'none'}</output>
      <output id="current-store-branch">{selectedBranch ?? 'none'}</output>
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
