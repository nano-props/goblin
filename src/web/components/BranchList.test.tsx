// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { BranchList } from '#/web/components/BranchList.tsx'
import { createRepoBranch, resetReposStore, seedRepoState } from '#/web/stores/repos/test-utils.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'

type TestDragEndEvent = { active: { id: string }; over: { id: string } | null }

const REPO_ID = '/tmp/repo'
let container: HTMLDivElement | null = null
let root: Root | null = null
let originalScrollIntoView: typeof Element.prototype.scrollIntoView | undefined
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const dndState = vi.hoisted(() => ({
  lastDragEnd: null as ((event: TestDragEndEvent) => void) | null,
}))

vi.mock('#/web/stores/i18n.ts', () => ({
  useI18nStore: (selector: (state: { lang: string }) => string) => selector({ lang: 'zh' }),
  useT: () => (key: string) => {
    if (key === 'branches.reorder-worktree') return '重新排序工作树'
    if (key === 'branches.empty') return '该仓库暂无分支。'
    if (key === 'branches.filter-empty') return '没有匹配当前筛选或搜索的分支。'
    if (key === 'branches.worktree') return '工作树'
    if (key === 'branches.dirty') return '有改动'
    if (key === 'branches.default') return '默认'
    if (key === 'branches.gone') return '已失联'
    if (key === 'branch-status.current') return '当前'
    return key
  },
}))

vi.mock('#/web/main-window-navigation.tsx', () => ({
  useMainWindowNavigation: () => ({
    selectRepoBranch: vi.fn(),
    showRepoDetailTab: vi.fn(),
  }),
}))

vi.mock('#/web/components/ui/scroll-area.tsx', () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('#/web/components/BranchActionsMenu.tsx', () => ({
  BranchActionsMenu: () => null,
}))

vi.mock('@dnd-kit/core', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/core')>('@dnd-kit/core')
  return {
    ...actual,
    DndContext: ({ children, onDragEnd }: { children: ReactNode; onDragEnd: (event: TestDragEndEvent) => void }) => {
      dndState.lastDragEnd = onDragEnd
      return <>{children}</>
    },
    PointerSensor: vi.fn(),
    closestCenter: vi.fn(),
    useSensor: () => ({}),
    useSensors: () => [],
  }
})

vi.mock('@dnd-kit/sortable', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/sortable')>('@dnd-kit/sortable')
  return {
    ...actual,
    SortableContext: ({ children }: { children: ReactNode }) => <>{children}</>,
    useSortable: ({ id }: { id: string }) => ({
      attributes: { 'data-sortable-id': id },
      listeners: {},
      setNodeRef: vi.fn(),
      setActivatorNodeRef: vi.fn(),
      transform: null,
      transition: undefined,
      isDragging: false,
    }),
  }
})

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  originalScrollIntoView = Element.prototype.scrollIntoView
  Element.prototype.scrollIntoView = vi.fn()
  dndState.lastDragEnd = null
  resetReposStore()
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  document.body.innerHTML = ''
  if (originalScrollIntoView) Element.prototype.scrollIntoView = originalScrollIntoView
  else Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

function seedWorktreeRepo(branchViewMode: 'all' | 'worktrees' | 'no-worktree' = 'worktrees') {
  seedRepoState({
    id: REPO_ID,
    branchViewMode,
    branches: [
      createRepoBranch('main', { worktree: { path: '/repo' } }),
      createRepoBranch('feature/a', { worktree: { path: '/tmp/worktree-a' } }),
      createRepoBranch('feature/plain'),
    ],
    currentBranch: 'main',
    selectedBranch: 'main',
  })
}

function renderList() {
  act(() => {
    root!.render(<BranchList repoId={REPO_ID} showActions={false} />)
  })
}

describe('BranchList worktree drag ordering', () => {
  test('shows drag handles only in worktrees view without search', () => {
    seedWorktreeRepo('worktrees')

    renderList()

    expect(document.querySelectorAll('[aria-label="重新排序工作树"]')).toHaveLength(2)
  })

  test('hides drag handles in all view', () => {
    seedWorktreeRepo('all')

    renderList()

    expect(document.querySelectorAll('[aria-label="重新排序工作树"]')).toHaveLength(0)
  })

  test('hides drag handles while search is active', () => {
    seedWorktreeRepo('worktrees')
    useReposStore.getState().setBranchSearchQuery(REPO_ID, 'feature')

    renderList()

    expect(document.querySelectorAll('[aria-label="重新排序工作树"]')).toHaveLength(0)
  })

  test('reorders worktrees when drag ends over another worktree', () => {
    seedWorktreeRepo('worktrees')
    renderList()

    act(() => {
      dndState.lastDragEnd?.({ active: { id: '/tmp/worktree-a' }, over: { id: '/repo' } })
    })

    expect(useReposStore.getState().repos[REPO_ID]?.ui.worktreePathOrder).toEqual(['/tmp/worktree-a', '/repo'])
  })
})
