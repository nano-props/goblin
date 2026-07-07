import { beforeEach, describe, expect, test } from 'vitest'
import { resetReposStore } from '#/web/test-utils/bridge.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { WorkspaceNavigationHistoryEntry } from '#/web/stores/repos/types.ts'

const REPO_ID = '/tmp/repo'

beforeEach(() => {
  resetReposStore()
})

describe('workspace navigation history', () => {
  test('records back and forward stacks per repo', () => {
    const store = useReposStore.getState()
    store.recordWorkspaceNavigation(entry('dashboard'))
    store.recordWorkspaceNavigation(entry('branch', 'feature/a'))
    store.recordWorkspaceNavigation(entry('branch', 'feature/b'))

    expect(history().current).toEqual(entry('branch', 'feature/b'))
    expect(history().backStack).toEqual([entry('dashboard'), entry('branch', 'feature/a')])
    expect(history().forwardStack).toEqual([])

    expect(useReposStore.getState().goBackInWorkspaceNavigation(REPO_ID)).toEqual(entry('branch', 'feature/a'))
    expect(history().current).toEqual(entry('branch', 'feature/a'))
    expect(history().backStack).toEqual([entry('dashboard')])
    expect(history().forwardStack).toEqual([entry('branch', 'feature/b')])

    expect(useReposStore.getState().goForwardInWorkspaceNavigation(REPO_ID)).toEqual(entry('branch', 'feature/b'))
    expect(history().current).toEqual(entry('branch', 'feature/b'))
    expect(history().backStack).toEqual([entry('dashboard'), entry('branch', 'feature/a')])
    expect(history().forwardStack).toEqual([])
  })

  test('drops the forward stack after a new selection', () => {
    const store = useReposStore.getState()
    store.recordWorkspaceNavigation(entry('dashboard'))
    store.recordWorkspaceNavigation(entry('branch', 'feature/a'))
    store.recordWorkspaceNavigation(entry('branch', 'feature/b'))
    store.goBackInWorkspaceNavigation(REPO_ID)

    useReposStore.getState().recordWorkspaceNavigation(entry('newWorktree'))

    expect(history().current).toEqual(entry('newWorktree'))
    expect(history().backStack).toEqual([entry('dashboard'), entry('branch', 'feature/a')])
    expect(history().forwardStack).toEqual([])
  })

  test('does not duplicate the current entry', () => {
    const store = useReposStore.getState()
    store.recordWorkspaceNavigation(entry('branch', 'feature/a'))
    store.recordWorkspaceNavigation(entry('branch', 'feature/a'))

    expect(history().current).toEqual(entry('branch', 'feature/a'))
    expect(history().backStack).toEqual([])
  })

  test('updates branch metadata without adding a back entry', () => {
    const store = useReposStore.getState()
    store.recordWorkspaceNavigation(branchEntry({ tab: 'status', terminalSessionId: null }))
    store.recordWorkspaceNavigation(branchEntry({ tab: 'status', terminalSessionId: 'session-1' }))

    expect(history().current).toEqual(branchEntry({ tab: 'status', terminalSessionId: 'session-1' }))
    expect(history().backStack).toEqual([])
  })

  test('collapses pending terminal creation into the current terminal entry', () => {
    const store = useReposStore.getState()
    const status = branchEntry({ tab: 'status', terminalSessionId: null })
    const pendingTerminal = branchEntry({ tab: 'terminal', terminalSessionId: null })
    const createdTerminal = branchEntry({ tab: 'terminal', terminalSessionId: 'session-1' })

    store.recordWorkspaceNavigation(status)
    store.recordWorkspaceNavigation(pendingTerminal)
    store.recordWorkspaceNavigation(createdTerminal)

    expect(history().current).toEqual(createdTerminal)
    expect(history().backStack).toEqual([status])
  })

  test('records explicit terminal session switches as navigation', () => {
    const store = useReposStore.getState()
    const firstTerminal = branchEntry({ tab: 'terminal', terminalSessionId: 'session-1' })
    const secondTerminal = branchEntry({ tab: 'terminal', terminalSessionId: 'session-2' })

    store.recordWorkspaceNavigation(firstTerminal)
    store.recordWorkspaceNavigation(secondTerminal)

    expect(history().current).toEqual(secondTerminal)
    expect(history().backStack).toEqual([firstTerminal])
  })

  test('treats a new-worktree return target as part of the route identity', () => {
    const store = useReposStore.getState()
    store.recordWorkspaceNavigation(newWorktreeEntry('/repo/repo-slug/branch/feature-a'))
    store.recordWorkspaceNavigation(newWorktreeEntry('/repo/repo-slug/dashboard'))

    expect(history().current).toEqual(newWorktreeEntry('/repo/repo-slug/dashboard'))
    expect(history().backStack).toEqual([newWorktreeEntry('/repo/repo-slug/branch/feature-a')])
  })
})

function history() {
  return useReposStore.getState().navigationHistoryByRepo[REPO_ID]!
}

function entry(kind: 'dashboard' | 'newWorktree'): WorkspaceNavigationHistoryEntry
function entry(kind: 'branch', branchName: string): WorkspaceNavigationHistoryEntry
function entry(kind: 'dashboard' | 'newWorktree' | 'branch', branchName?: string): WorkspaceNavigationHistoryEntry {
  if (kind === 'branch') {
    return {
      repoId: REPO_ID,
      route: {
        kind,
        branchName: branchName ?? 'feature/test',
        workspacePaneTab: 'status',
        terminalWorktreeKey: null,
        terminalSessionId: null,
      },
    }
  }
  if (kind === 'newWorktree') return newWorktreeEntry(null)
  return { repoId: REPO_ID, route: { kind } }
}

function newWorktreeEntry(returnTo: string | null): WorkspaceNavigationHistoryEntry {
  return { repoId: REPO_ID, route: { kind: 'newWorktree', returnTo } }
}

function branchEntry({
  tab,
  terminalSessionId,
}: {
  tab: 'status' | 'terminal'
  terminalSessionId: string | null
}): WorkspaceNavigationHistoryEntry {
  return {
    repoId: REPO_ID,
    route: {
      kind: 'branch',
      branchName: 'feature/a',
      workspacePaneTab: tab,
      terminalWorktreeKey: '/tmp/repo\0/tmp/repo-worktree',
      terminalSessionId,
    },
  }
}
