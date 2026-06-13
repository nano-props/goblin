// @vitest-environment jsdom

import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { CreateWorktreeDialog } from '#/web/components/CreateWorktreeDialog.tsx'
import { emptyRepo } from '#/web/stores/repos/helpers.ts'
import type { RepoState } from '#/web/stores/repos/types.ts'
import { normalizeRemoteTarget } from '#/shared/remote-repo.ts'

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const testWindow = window as unknown as { goblinNative?: unknown }

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  testWindow.goblinNative = {
    homeDir: '/Users/tester',
    initialServer: { url: 'http://127.0.0.1:32100/', secret: 'secret' },
    pathForFile: () => '',
    invokeIpc: async () => null,
    abortIpc: async () => true,
    onEvent: () => () => {},
  }
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  document.body.innerHTML = ''
  delete testWindow.goblinNative
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

describe('CreateWorktreeDialog', () => {
  test('focuses the new branch input when opened in newBranch mode', () => {
    render(<CreateWorktreeDialog open repo={createRepo()} onClose={vi.fn()} onCreate={vi.fn(async () => {})} />)

    expect(document.activeElement).toBe(input('#cwt-branch'))
  })

  test('submits a newBranch request and closes', () => {
    const deferred = createDeferred<void>()
    const onClose = vi.fn()
    const onCreate = vi.fn(() => deferred.promise)

    render(<CreateWorktreeDialog open repo={createRepo()} onClose={onClose} onCreate={onCreate} />)

    setInputValue('#cwt-branch', 'feature/new')
    click('button[type="submit"]')

    expect(onCreate).toHaveBeenCalledWith({
      input: {
        worktreePath: '/tmp/goblin-repo-feature-new',
        mode: { kind: 'newBranch', newBranch: 'feature/new', baseRef: 'main' },
      },
    })
    expect(onClose).toHaveBeenCalledTimes(1)
    deferred.resolve()
  })

  test('switches to existingBranch mode and submits a checkout', () => {
    const onClose = vi.fn()
    const onCreate = vi.fn(async () => {})

    render(<CreateWorktreeDialog open repo={createRepo()} onClose={onClose} onCreate={onCreate} />)

    clickModeButton('existing')
    // After switching to existingBranch, base resets to current branch
    // ("main") and the submit button stays disabled until that branch
    // is verified to exist in the repo's snapshot (it does).
    expect(button('button[type="submit"]').disabled).toBe(false)
    click('button[type="submit"]')
    expect(onCreate).toHaveBeenCalledWith({
      input: {
        worktreePath: '/tmp/goblin-repo-main',
        mode: { kind: 'existingBranch', branch: 'main' },
      },
    })
  })

  test('keeps home-relative remote worktree paths in the submitted payload', () => {
    const onClose = vi.fn()
    const onCreate = vi.fn(async () => {})

    render(<CreateWorktreeDialog open repo={createRemoteRepo()} onClose={onClose} onCreate={onCreate} />)

    setInputValue('#cwt-branch', 'feature/new')
    setInputValue('#cwt-path', '~/trees/repo-feature-new')
    click('button[type="submit"]')

    expect(onCreate).toHaveBeenCalledWith({
      input: {
        worktreePath: '~/trees/repo-feature-new',
        mode: { kind: 'newBranch', newBranch: 'feature/new', baseRef: 'main' },
      },
    })
  })
})

function createRepo(): RepoState {
  const repo = emptyRepo('/tmp/goblin-repo', 'goblin-repo')
  repo.data.currentBranch = 'main'
  repo.data.branches = [
    {
      name: 'main',
      isCurrent: true,
      ahead: 0,
      behind: 0,
      lastCommitHash: '1111111',
      lastCommitMessage: 'Main commit',
      lastCommitDate: '2024-01-01T00:00:00.000Z',
      lastCommitAuthor: 'Test',
    },
    {
      name: 'feature/base',
      isCurrent: false,
      ahead: 0,
      behind: 0,
      lastCommitHash: '2222222',
      lastCommitMessage: 'Feature base',
      lastCommitDate: '2024-01-02T00:00:00.000Z',
      lastCommitAuthor: 'Test',
    },
  ]
  return repo
}

function createRemoteRepo(): RepoState {
  const target = normalizeRemoteTarget({
    alias: 'prod',
    host: 'example.com',
    user: 'alice',
    port: 22,
    remotePath: '/srv/repo',
  })
  if (!target) throw new Error('Failed to create remote target for test')
  const repo = createRepo()
  repo.id = target.id
  repo.remote.target = target
  return repo
}

function render(element: ReactNode) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => {
    root!.render(element)
  })
}

function input(selector: string): HTMLInputElement {
  const element = document.body.querySelector(selector)
  if (!(element instanceof HTMLInputElement)) throw new Error(`Missing input: ${selector}`)
  return element
}

function button(selector: string): HTMLButtonElement {
  const element = document.body.querySelector(selector)
  if (!(element instanceof HTMLButtonElement)) throw new Error(`Missing button: ${selector}`)
  return element
}

function clickModeButton(label: string): void {
  // The ToggleGroup items render an inline SVG icon alongside the label,
  // so textContent matches aren't stable. The Radix primitive also doesn't
  // forward `value` as a DOM attribute. Walk the rendered buttons and
  // match the visible label substring (this test runs with the default zh
  // dictionary so labels like "现有" / "Existing" both work).
  const element = [...document.body.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.toLowerCase().includes(label.toLowerCase()),
  )
  if (!(element instanceof HTMLButtonElement)) throw new Error(`Missing mode button: ${label}`)
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

function setInputValue(selector: string, value: string) {
  const element = input(selector)
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
  descriptor?.set?.call(element, value)
  act(() => {
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function click(selector: string) {
  const element = button(selector)
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
