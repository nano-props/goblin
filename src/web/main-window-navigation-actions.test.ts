import { describe, expect, test, vi } from 'vitest'
import { createMainWindowNavigationActions } from '#/web/main-window-navigation-actions.ts'

describe('createMainWindowNavigationActions', () => {
  test('mutates store directly for repo branch workspace navigation', () => {
    const setActive = vi.fn()
    const selectBranch = vi.fn()
    const setWorkspacePaneTab = vi.fn()
    const actions = createMainWindowNavigationActions({
      activeId: '/tmp/repo-a',
      order: ['/tmp/repo-a', '/tmp/repo-b'],
      setActive,
      closeRepo: vi.fn(),
      cycleActive: vi.fn(),
      selectBranch,
      setWorkspacePaneTab,
      onOpenSettings: vi.fn(),
    })

    actions.showRepoBranchWorkspacePaneTab('/tmp/repo-b', 'feature/test', 'terminal')

    expect(setActive).toHaveBeenCalledWith('/tmp/repo-b')
    expect(selectBranch).toHaveBeenCalledWith('/tmp/repo-b', 'feature/test')
    expect(setWorkspacePaneTab).toHaveBeenCalledWith('/tmp/repo-b', 'terminal')
  })

  test('workspace pane navigation updates the preferred workspace pane view', () => {
    const setWorkspacePaneTab = vi.fn()
    const actions = createMainWindowNavigationActions({
      activeId: '/tmp/repo-a',
      order: ['/tmp/repo-a'],
      setActive: vi.fn(),
      closeRepo: vi.fn(),
      cycleActive: vi.fn(),
      selectBranch: vi.fn(),
      setWorkspacePaneTab,
    })

    actions.showRepoWorkspacePaneTab('/tmp/repo-a', 'changes')

    expect(setWorkspacePaneTab).toHaveBeenCalledWith('/tmp/repo-a', 'changes')
  })

  test('cycles repos through the store action', () => {
    const cycleActive = vi.fn()
    const actions = createMainWindowNavigationActions({
      activeId: '/tmp/repo-a',
      order: ['/tmp/repo-a', '/tmp/repo-b', '/tmp/repo-c'],
      setActive: vi.fn(),
      closeRepo: vi.fn(),
      cycleActive,
      selectBranch: vi.fn(),
      setWorkspacePaneTab: vi.fn(),
    })

    actions.cycleRepo(1)

    expect(cycleActive).toHaveBeenCalledWith(1)
  })

  test('closes the repo through the store action', () => {
    const closeRepo = vi.fn()
    const actions = createMainWindowNavigationActions({
      activeId: '/tmp/repo-b',
      order: ['/tmp/repo-a', '/tmp/repo-b', '/tmp/repo-c'],
      setActive: vi.fn(),
      closeRepo,
      cycleActive: vi.fn(),
      selectBranch: vi.fn(),
      setWorkspacePaneTab: vi.fn(),
    })

    actions.closeRepo('/tmp/repo-b')

    expect(closeRepo).toHaveBeenCalledWith('/tmp/repo-b')
  })
})
