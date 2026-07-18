import { beforeEach, describe, expect, test } from 'vitest'
import { resetWorkspacesStore } from '#/web/test-utils/bridge.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import type { WorkspaceNavigationHistoryEntry } from '#/web/stores/workspaces/types.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const REPO_ID = workspaceIdForTest('goblin+file:///tmp/repo')

beforeEach(() => {
  resetWorkspacesStore()
})

describe('workspace navigation history', () => {
  test('records back and forward stacks per repo', () => {
    const store = useWorkspacesStore.getState()
    store.recordWorkspaceNavigation(entry('dashboard'))
    store.recordWorkspaceNavigation(entry('branch', 'feature/a'))
    store.recordWorkspaceNavigation(entry('branch', 'feature/b'))

    expect(history().current).toEqual(entry('branch', 'feature/b'))
    expect(history().backStack).toEqual([entry('dashboard'), entry('branch', 'feature/a')])
    expect(history().forwardStack).toEqual([])

    expect(traverse('back')).toEqual(entry('branch', 'feature/a'))
    expect(history().current).toEqual(entry('branch', 'feature/a'))
    expect(history().backStack).toEqual([entry('dashboard')])
    expect(history().forwardStack).toEqual([entry('branch', 'feature/b')])

    expect(traverse('forward')).toEqual(entry('branch', 'feature/b'))
    expect(history().current).toEqual(entry('branch', 'feature/b'))
    expect(history().backStack).toEqual([entry('dashboard'), entry('branch', 'feature/a')])
    expect(history().forwardStack).toEqual([])
  })

  test('drops the forward stack after a new selection', () => {
    const store = useWorkspacesStore.getState()
    store.recordWorkspaceNavigation(entry('dashboard'))
    store.recordWorkspaceNavigation(entry('branch', 'feature/a'))
    store.recordWorkspaceNavigation(entry('branch', 'feature/b'))
    traverse('back')

    useWorkspacesStore.getState().recordWorkspaceNavigation(entry('newWorktree'))

    expect(history().current).toEqual(entry('newWorktree'))
    expect(history().backStack).toEqual([entry('dashboard'), entry('branch', 'feature/a')])
    expect(history().forwardStack).toEqual([])
  })

  test('rejects a stale traversal lease after history changes', () => {
    const store = useWorkspacesStore.getState()
    store.recordWorkspaceNavigation(entry('dashboard'))
    store.recordWorkspaceNavigation(entry('branch', 'feature/a'))
    const traversal = store.peekWorkspaceNavigation(REPO_ID, 'back')
    expect(traversal).not.toBeNull()

    store.recordWorkspaceNavigation(entry('branch', 'feature/b'))

    expect(store.commitWorkspaceNavigation(traversal!)).toBe(false)
    expect(history().current).toEqual(entry('branch', 'feature/b'))
    expect(history().backStack).toEqual([entry('dashboard'), entry('branch', 'feature/a')])
  })

  test('does not duplicate the current entry', () => {
    const store = useWorkspacesStore.getState()
    store.recordWorkspaceNavigation(entry('branch', 'feature/a'))
    store.recordWorkspaceNavigation(entry('branch', 'feature/a'))

    expect(history().current).toEqual(entry('branch', 'feature/a'))
    expect(history().backStack).toEqual([])
  })

  test('records the workspace root as its own navigable route', () => {
    const store = useWorkspacesStore.getState()
    const workspace = workspaceEntry()
    store.recordWorkspaceNavigation(entry('dashboard'))
    store.recordWorkspaceNavigation(workspace)

    expect(history().current).toEqual(workspace)
    expect(traverse('back')).toEqual(entry('dashboard'))
    expect(traverse('forward')).toEqual(workspace)
  })

  test('explicitly replaces the current entry without pushing history', () => {
    const store = useWorkspacesStore.getState()
    store.recordWorkspaceNavigation(entry('dashboard'))
    store.recordWorkspaceNavigation(entry('branch', 'feature/a'), { replace: true })

    expect(history().current).toEqual(entry('branch', 'feature/a'))
    expect(history().backStack).toEqual([])
    expect(history().forwardStack).toEqual([])
  })

  test('updates branch metadata without adding a back entry', () => {
    const store = useWorkspacesStore.getState()
    store.recordWorkspaceNavigation(branchEntry({ tab: 'status', terminalSessionId: null }))
    store.recordWorkspaceNavigation(branchEntry({ tab: 'status', terminalSessionId: 'term-111111111111111111111' }))

    expect(history().current).toEqual(branchEntry({ tab: 'status', terminalSessionId: 'term-111111111111111111111' }))
    expect(history().backStack).toEqual([])
  })

  test('collapses pending terminal creation into the current terminal entry', () => {
    const store = useWorkspacesStore.getState()
    const status = branchEntry({ tab: 'status', terminalSessionId: null })
    const pendingTerminal = branchEntry({ tab: 'terminal', terminalSessionId: null })
    const createdTerminal = branchEntry({ tab: 'terminal', terminalSessionId: 'term-111111111111111111111' })

    store.recordWorkspaceNavigation(status)
    store.recordWorkspaceNavigation(pendingTerminal)
    store.recordWorkspaceNavigation(createdTerminal)

    expect(history().current).toEqual(createdTerminal)
    expect(history().backStack).toEqual([status])
  })

  test('records explicit terminal session switches as navigation', () => {
    const store = useWorkspacesStore.getState()
    const firstTerminal = branchEntry({ tab: 'terminal', terminalSessionId: 'term-111111111111111111111' })
    const secondTerminal = branchEntry({ tab: 'terminal', terminalSessionId: 'term-222222222222222222222' })

    store.recordWorkspaceNavigation(firstTerminal)
    store.recordWorkspaceNavigation(secondTerminal)

    expect(history().current).toEqual(secondTerminal)
    expect(history().backStack).toEqual([firstTerminal])
  })

  test('restores the cursor when browser history lands on a back stack entry', () => {
    const store = useWorkspacesStore.getState()
    const dashboard = entry('dashboard')
    const status = branchEntry({ tab: 'status', terminalSessionId: null })
    const terminal = branchEntry({ tab: 'terminal', terminalSessionId: 'term-111111111111111111111' })

    store.recordWorkspaceNavigation(dashboard)
    store.recordWorkspaceNavigation(status)
    store.recordWorkspaceNavigation(terminal)
    store.recordWorkspaceNavigation(dashboard, { browserHistoryTraversal: 'back' })

    expect(history().current).toEqual(dashboard)
    expect(history().backStack).toEqual([])
    expect(history().forwardStack).toEqual([status, terminal])
  })

  test('restores the cursor when browser history lands on a forward stack entry', () => {
    const store = useWorkspacesStore.getState()
    const dashboard = entry('dashboard')
    const status = branchEntry({ tab: 'status', terminalSessionId: null })
    const terminal = branchEntry({ tab: 'terminal', terminalSessionId: 'term-111111111111111111111' })

    store.recordWorkspaceNavigation(dashboard)
    store.recordWorkspaceNavigation(status)
    store.recordWorkspaceNavigation(terminal)
    store.recordWorkspaceNavigation(dashboard, { browserHistoryTraversal: 'back' })
    store.recordWorkspaceNavigation(terminal, { browserHistoryTraversal: 'forward' })

    expect(history().current).toEqual(terminal)
    expect(history().backStack).toEqual([dashboard, status])
    expect(history().forwardStack).toEqual([])
  })

  test('restores the cursor when browser back lands on an app forward stack entry', () => {
    const store = useWorkspacesStore.getState()
    const dashboard = entry('dashboard')
    const status = branchEntry({ tab: 'status', terminalSessionId: null })
    const terminal = branchEntry({ tab: 'terminal', terminalSessionId: 'term-111111111111111111111' })

    store.recordWorkspaceNavigation(dashboard)
    store.recordWorkspaceNavigation(status)
    store.recordWorkspaceNavigation(terminal)
    traverse('back')
    store.recordWorkspaceNavigation(terminal, { browserHistoryTraversal: 'back' })

    expect(history().current).toEqual(terminal)
    expect(history().backStack).toEqual([dashboard, status])
    expect(history().forwardStack).toEqual([])
  })

  test('replaces a restored stale browser entry with its canonical route without losing the cursor move', () => {
    const store = useWorkspacesStore.getState()
    const dashboard = entry('dashboard')
    const staleTerminal = branchEntry({ tab: 'terminal', terminalSessionId: 'stale-session' })
    const status = branchEntry({ tab: 'status', terminalSessionId: null })

    store.recordWorkspaceNavigation(dashboard)
    store.recordWorkspaceNavigation(staleTerminal)
    store.recordWorkspaceNavigation(status)
    store.recordWorkspaceNavigation(staleTerminal, { browserHistoryTraversal: 'back' })
    store.recordWorkspaceNavigation(status, { replace: true })

    expect(history().current).toEqual(status)
    expect(history().backStack).toEqual([dashboard])
    expect(history().forwardStack).toEqual([])
  })

  test('dedupes the new current route from the forward stack after replacing a restored stale entry', () => {
    const store = useWorkspacesStore.getState()
    const dashboard = entry('dashboard')
    const staleTerminal = branchEntry({ tab: 'terminal', terminalSessionId: 'stale-session' })
    const status = branchEntry({ tab: 'status', terminalSessionId: null })

    store.recordWorkspaceNavigation(dashboard)
    store.recordWorkspaceNavigation(staleTerminal)
    store.recordWorkspaceNavigation(status)
    traverse('back')
    store.recordWorkspaceNavigation(status, { replace: true })

    expect(history().current).toEqual(status)
    expect(history().backStack).toEqual([dashboard])
    expect(history().forwardStack).toEqual([])
  })

  test('treats a new-worktree return target as part of the route identity', () => {
    const store = useWorkspacesStore.getState()
    store.recordWorkspaceNavigation(newWorktreeEntry('/repo/repo-slug/branch/feature-a'))
    store.recordWorkspaceNavigation(newWorktreeEntry('/repo/repo-slug/dashboard'))

    expect(history().current).toEqual(newWorktreeEntry('/repo/repo-slug/dashboard'))
    expect(history().backStack).toEqual([newWorktreeEntry('/repo/repo-slug/branch/feature-a')])
  })
})

function history() {
  return useWorkspacesStore.getState().navigationHistoryByWorkspace[REPO_ID]!
}

function traverse(direction: 'back' | 'forward'): WorkspaceNavigationHistoryEntry | null {
  const store = useWorkspacesStore.getState()
  const traversal = store.peekWorkspaceNavigation(REPO_ID, direction)
  if (!traversal) return null
  return store.commitWorkspaceNavigation(traversal) ? traversal.target : null
}

function entry(kind: 'dashboard' | 'newWorktree'): WorkspaceNavigationHistoryEntry
function entry(kind: 'branch', branchName: string): WorkspaceNavigationHistoryEntry
function entry(kind: 'dashboard' | 'newWorktree' | 'branch', branchName?: string): WorkspaceNavigationHistoryEntry {
  if (kind === 'branch') {
    return {
      workspaceId: REPO_ID,
      route: {
        kind,
        branchName: branchName ?? 'feature/test',
        workspacePaneTab: null,
        terminalWorktreeKey: null,
        terminalSessionId: null,
      },
    }
  }
  if (kind === 'newWorktree') return newWorktreeEntry(null)
  return { workspaceId: REPO_ID, route: { kind } }
}

function newWorktreeEntry(returnTo: string | null): WorkspaceNavigationHistoryEntry {
  return { workspaceId: REPO_ID, route: { kind: 'newWorktree', returnTo } }
}

function workspaceEntry(): WorkspaceNavigationHistoryEntry {
  return { workspaceId: REPO_ID, route: { kind: 'workspace-root' } }
}

function branchEntry({
  tab,
  terminalSessionId,
}: {
  tab: 'status' | 'terminal'
  terminalSessionId: string | null
}): WorkspaceNavigationHistoryEntry {
  return {
    workspaceId: REPO_ID,
    route: {
      kind: 'branch',
      branchName: 'feature/a',
      workspacePaneTab: tab,
      terminalWorktreeKey: 'goblin+file:///tmp/repo\0goblin+file:///tmp/repo-worktree',
      terminalSessionId,
    },
  }
}
