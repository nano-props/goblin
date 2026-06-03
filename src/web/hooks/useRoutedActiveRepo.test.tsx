// @vitest-environment jsdom

import { act } from 'react'
import { useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { useRoutedActiveRepo } from '#/web/hooks/useRoutedActiveRepo.ts'
import { createBranchSnapshot, resetReposStore, seedRepoState } from '#/web/stores/repos/test-utils.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

function Harness({ initialRouteRepoId }: { initialRouteRepoId: string | null }) {
  const activeId = useReposStore((s) => s.activeId)
  const sessionReady = useReposStore((s) => s.sessionReady)
  const [routeRepoId, setRouteRepoId] = useState<string | null>(initialRouteRepoId)
  useRoutedActiveRepo({
    activeId,
    sessionReady,
    routeRepoId,
    onRouteRepoChange: setRouteRepoId,
  })

  return (
    <>
      <button
        id="set-store-repo-a"
        type="button"
        onClick={() => {
          useReposStore.getState().setActive('/tmp/repo-a')
        }}
      >
        set store repo a
      </button>
      <output id="route-repo">{routeRepoId ?? 'none'}</output>
      <output id="active-repo">{activeId ?? 'none'}</output>
    </>
  )
}

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  resetReposStore()
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

describe('useRoutedActiveRepo', () => {
  test('keeps the route repo authoritative without forcing store activeId to follow it', async () => {
    const repoA = seedRepoState({
      id: '/tmp/repo-a',
      name: 'repo-a',
      currentBranch: 'main',
      selectedBranch: 'main',
      branchSnapshots: [createBranchSnapshot('main', { isCurrent: true, worktree: { path: '/tmp/repo-a-worktree' } })],
    })
    const repoB = {
      ...repoA,
      id: '/tmp/repo-b',
      name: 'repo-b',
      instanceToken: repoA.instanceToken + 1,
      remote: { ...repoA.remote },
      availability: { ...repoA.availability },
      cache: { ...repoA.cache },
      ui: { ...repoA.ui },
      data: {
        ...repoA.data,
        branches: [...repoA.data.branches],
        status: [...repoA.data.status],
        worktreesByPath: { ...repoA.data.worktreesByPath },
      },
      resources: { ...repoA.resources },
      operations: { ...repoA.operations },
      events: [...repoA.events],
    }
    useReposStore.setState((s) => ({
      ...s,
      repos: {
        [repoA.id]: repoA,
        [repoB.id]: repoB,
      },
      order: [repoA.id, repoB.id],
      activeId: repoA.id,
      sessionReady: true,
    }))

    await render(<Harness initialRouteRepoId={repoB.id} />)

    expect(text('#active-repo')).toBe(repoA.id)
    expect(text('#route-repo')).toBe(repoB.id)

    await click('#set-store-repo-a')
    expect(text('#active-repo')).toBe(repoA.id)
    expect(text('#route-repo')).toBe(repoB.id)
  })

  test('drops missing route repo ids once session restore is ready', async () => {
    seedRepoState({
      id: '/tmp/repo-a',
      name: 'repo-a',
      currentBranch: 'main',
      selectedBranch: 'main',
      branchSnapshots: [createBranchSnapshot('main', { isCurrent: true, worktree: { path: '/tmp/repo-a-worktree' } })],
    })

    await render(<Harness initialRouteRepoId="/tmp/missing-repo" />)

    expect(text('#active-repo')).toBe('/tmp/repo-a')
    expect(text('#route-repo')).toBe('/tmp/repo-a')
  })

  test('fills a missing route from the restored active repo once session is ready', async () => {
    seedRepoState({
      id: '/tmp/repo-a',
      name: 'repo-a',
      currentBranch: 'main',
      selectedBranch: 'main',
      branchSnapshots: [createBranchSnapshot('main', { isCurrent: true, worktree: { path: '/tmp/repo-a-worktree' } })],
    })

    await render(<Harness initialRouteRepoId={null} />)

    expect(text('#active-repo')).toBe('/tmp/repo-a')
    expect(text('#route-repo')).toBe('/tmp/repo-a')
  })
})

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
