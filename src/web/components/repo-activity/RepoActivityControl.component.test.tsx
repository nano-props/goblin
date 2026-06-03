// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { RepoActivityControl } from '#/web/components/repo-activity/RepoActivityControl.tsx'
import { resetReposStore, seedRepoState } from '#/web/stores/repos/test-utils.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'

const REPO_ID = '/tmp/repo-activity-control-component'

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

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

describe('RepoActivityControl component', () => {
  test('keeps the primary refresh button enabled during background-blocked refresh states', () => {
    seedRepoState({ id: REPO_ID, remote: { hasRemotes: true } })
    useReposStore.setState((state) => {
      const repo = state.repos[REPO_ID]
      if (!repo) return state
      repo.resources.status.phase = 'refreshing'
      repo.operations.status.phase = 'running'
      repo.operations.status.reason = 'status'
      return { repos: { ...state.repos, [REPO_ID]: { ...repo } } }
    })

    render(<RepoActivityControl repoId={REPO_ID} />)

    expect(button().disabled).toBe(false)
    expect(button().getAttribute('aria-busy')).toBeNull()
  })

  test('disables the primary refresh button during manual refreshes', () => {
    seedRepoState({ id: REPO_ID, remote: { hasRemotes: true } })
    useReposStore.setState((state) => {
      const repo = state.repos[REPO_ID]
      if (!repo) return state
      repo.operations.fetch.phase = 'running'
      repo.operations.fetch.reason = 'user-fetch'
      return { repos: { ...state.repos, [REPO_ID]: { ...repo } } }
    })

    render(<RepoActivityControl repoId={REPO_ID} />)

    expect(button().disabled).toBe(true)
    expect(button().getAttribute('aria-busy')).toBe('true')
  })

  test('renders the primary refresh button for local-only repositories without the local-only label', () => {
    seedRepoState({ id: REPO_ID, remote: { hasRemotes: false } })

    render(<RepoActivityControl repoId={REPO_ID} />)

    expect(button().disabled).toBe(false)
    expect(document.body.textContent).not.toContain('tab.local-only')
  })
})

function render(element: ReactNode) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => {
    root!.render(element)
  })
}

function button(): HTMLButtonElement {
  const element = document.body.querySelector('button')
  if (!(element instanceof HTMLButtonElement)) throw new Error('Missing refresh button')
  return element
}
