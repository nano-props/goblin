# Branch Worktree List Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show linked worktree directories in the branch list and let users drag-order worktrees in the Worktrees filter view.

**Architecture:** Keep ordering as renderer-owned per-repository UI state. Apply order through the branch visibility helper so React components consume already ordered branch arrays. Use dnd-kit only in the Worktrees view with an empty search query, and persist order through the existing repo cache boundary.

**Tech Stack:** React, Zustand, dnd-kit, Vitest, Valibot, Tailwind, existing repo cache persistence.

**Repository Rule:** This plan intentionally contains no git commit or branch steps. The repository instructions say not to plan or execute commits or branch operations unless the user explicitly requests them.

---

## File Map

- Modify `src/web/stores/repos/types.ts`: add `worktreePathOrder` to `RepoUiState` and `CachedRepoState.ui`, plus the `reorderWorktrees` action type on `ReposStore`.
- Modify `src/web/stores/repos/helpers.ts`: initialize empty repos with `worktreePathOrder: []`.
- Modify `src/web/stores/repos/test-utils.ts`: allow tests to seed `branchViewMode` and `worktreePathOrder`.
- Modify `src/web/stores/repos/branch-view-mode.ts`: add pure helpers for worktree path order normalization and ordered visible branches.
- Create `src/web/stores/repos/branch-view-mode.test.ts`: cover ordering rules.
- Modify `src/web/stores/repos/persistence.ts`: validate, hydrate, normalize, and persist `worktreePathOrder`.
- Modify `src/web/stores/repos/persistence.test.ts`: cover cache behavior.
- Modify `src/web/stores/repos/selection.ts`: add `reorderWorktrees(repoId, fromPath, toPath)`.
- Modify `src/web/stores/repos/selection.test.ts`: cover reorder action behavior.
- Modify `src/web/components/repo-workspace/BranchSummaryInline.tsx`: render worktree directory as a second line.
- Modify `src/web/components/branch-list/BranchRow.tsx`: add optional drag handle and sortable row props without making every row draggable.
- Modify `src/web/components/branch-list/BranchRow.test.tsx`: cover directory display and drag handle basics.
- Modify `src/web/components/BranchList.tsx`: wire ordered branches, dnd-kit context, drag enablement, and `reorderWorktrees`.
- Create `src/web/components/BranchList.test.tsx`: cover drag handle conditions and drag-end store wiring.
- Modify `src/shared/i18n/en.ts`, `src/shared/i18n/zh.ts`, `src/shared/i18n/ja.ts`, `src/shared/i18n/ko.ts`: add drag handle accessibility label.

## Task 1: Branch Ordering Helper

**Files:**
- Modify: `src/web/stores/repos/branch-view-mode.ts`
- Create: `src/web/stores/repos/branch-view-mode.test.ts`

- [ ] **Step 1: Write failing ordering helper tests**

Create `src/web/stores/repos/branch-view-mode.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { visibleBranches, normalizeWorktreePathOrder } from '#/web/stores/repos/branch-view-mode.ts'
import { createRepoBranch } from '#/web/stores/repos/test-utils.ts'

const branches = [
  createRepoBranch('main', { worktree: { path: '/repo' } }),
  createRepoBranch('feature/a', { worktree: { path: '/tmp/worktree-a' } }),
  createRepoBranch('feature/plain'),
  createRepoBranch('feature/b', { worktree: { path: '/tmp/worktree-b' } }),
]

describe('visibleBranches worktree ordering', () => {
  test('orders worktree view by saved worktree paths and appends new paths', () => {
    const visible = visibleBranches({
      branches,
      viewMode: 'worktrees',
      worktreePathOrder: ['/tmp/worktree-b', '/repo'],
    })

    expect(visible.map((branch) => branch.name)).toEqual(['feature/b', 'main', 'feature/a'])
  })

  test('orders all view worktrees first and preserves plain branch order after them', () => {
    const visible = visibleBranches({
      branches,
      viewMode: 'all',
      worktreePathOrder: ['/tmp/worktree-b', '/repo'],
    })

    expect(visible.map((branch) => branch.name)).toEqual(['feature/b', 'main', 'feature/a', 'feature/plain'])
  })

  test('keeps no-worktree view in branch snapshot order', () => {
    const visible = visibleBranches({
      branches,
      viewMode: 'no-worktree',
      worktreePathOrder: ['/tmp/worktree-b', '/repo'],
    })

    expect(visible.map((branch) => branch.name)).toEqual(['feature/plain'])
  })

  test('filters by search before applying saved order', () => {
    const visible = visibleBranches({
      branches,
      viewMode: 'worktrees',
      searchQuery: 'feature',
      worktreePathOrder: ['/tmp/worktree-b', '/repo', '/tmp/worktree-a'],
    })

    expect(visible.map((branch) => branch.name)).toEqual(['feature/b', 'feature/a'])
  })

  test('normalizes stale order paths against current worktree paths', () => {
    expect(normalizeWorktreePathOrder(['/stale', '/tmp/worktree-b'], ['/repo', '/tmp/worktree-b'])).toEqual([
      '/tmp/worktree-b',
      '/repo',
    ])
  })
})
```

- [ ] **Step 2: Run tests and verify they fail for missing API**

Run:

```bash
bun run test -- src/web/stores/repos/branch-view-mode.test.ts
```

Expected: FAIL because `worktreePathOrder` and `normalizeWorktreePathOrder` are not implemented yet.

- [ ] **Step 3: Implement the pure ordering helper**

Modify `src/web/stores/repos/branch-view-mode.ts` with these exact interfaces and helper functions:

```ts
interface VisibleBranchesInput {
  branches: RepoBranchState[]
  viewMode: BranchViewMode
  searchQuery?: string
  worktreePathOrder?: string[]
}

export function normalizeWorktreePathOrder(order: string[] = [], currentPaths: string[]): string[] {
  const current = new Set(currentPaths)
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const path of order) {
    if (!current.has(path) || seen.has(path)) continue
    seen.add(path)
    normalized.push(path)
  }
  for (const path of currentPaths) {
    if (seen.has(path)) continue
    seen.add(path)
    normalized.push(path)
  }
  return normalized
}

function branchWorktreePath(branch: RepoBranchState): string | null {
  return branch.worktree?.path ?? null
}

function orderWorktreeBranches(branches: RepoBranchState[], order: string[] = []): RepoBranchState[] {
  const worktreePaths = branches.map(branchWorktreePath).filter((path): path is string => !!path)
  const normalized = normalizeWorktreePathOrder(order, worktreePaths)
  const indexByPath = new Map(normalized.map((path, index) => [path, index]))
  return [...branches].sort((a, b) => {
    const aPath = branchWorktreePath(a)
    const bPath = branchWorktreePath(b)
    const aIndex = aPath ? indexByPath.get(aPath) : undefined
    const bIndex = bPath ? indexByPath.get(bPath) : undefined
    if (aIndex === undefined && bIndex === undefined) return 0
    if (aIndex === undefined) return 1
    if (bIndex === undefined) return -1
    return aIndex - bIndex
  })
}

export function visibleBranches({
  branches,
  viewMode,
  searchQuery = '',
  worktreePathOrder = [],
}: VisibleBranchesInput): RepoBranchState[] {
  const filtered = branches.filter(
    (branch) => branchMatchesViewMode(branch, viewMode) && branchMatchesSearchQuery(branch, searchQuery),
  )
  if (viewMode === 'no-worktree') return filtered
  return orderWorktreeBranches(filtered, worktreePathOrder)
}
```

- [ ] **Step 4: Run helper tests and verify they pass**

Run:

```bash
bun run test -- src/web/stores/repos/branch-view-mode.test.ts
```

Expected: PASS.

## Task 2: Persisted Worktree Order State

**Files:**
- Modify: `src/web/stores/repos/types.ts`
- Modify: `src/web/stores/repos/helpers.ts`
- Modify: `src/web/stores/repos/test-utils.ts`
- Modify: `src/web/stores/repos/persistence.ts`
- Modify: `src/web/stores/repos/persistence.test.ts`
- Modify: `src/web/stores/repos/selection.ts`
- Modify: `src/web/stores/repos/selection.test.ts`

- [ ] **Step 1: Write failing persistence and store tests**

Add to `src/web/stores/repos/persistence.test.ts`:

```ts
test('normalizes missing and invalid worktree path order to an empty array', () => {
  const now = Date.now()
  const missing = cachedRepo(now) as any
  delete missing.ui.worktreePathOrder
  const invalid = cachedRepo(now) as any
  invalid.ui.worktreePathOrder = [123, '/tmp/worktree-a']

  const normalized = normalizeRepoCache({ missing, invalid })

  expect(normalized.missing?.ui.worktreePathOrder).toEqual([])
  expect(normalized.invalid).toBeUndefined()
})

test('persists worktree path order in repo cache', () => {
  const repo = seedRepoState({
    id: '/repo',
    instanceToken: 1,
    branches: [createRepoBranch('main', { worktree: { path: '/repo' } })],
    currentBranch: 'main',
    selectedBranch: 'main',
    worktreePathOrder: ['/repo'],
  })

  persistRepoCache(useReposStore.setState, repo, 1)

  expect(useReposStore.getState().repoCache['/repo']?.ui.worktreePathOrder).toEqual(['/repo'])
})
```

Add to `src/web/stores/repos/selection.test.ts`:

```ts
describe('reorderWorktrees', () => {
  test('moves worktree paths and persists repo cache', () => {
    seedRepo({
      selectedBranch: 'main',
      branches: [
        branch('main', { worktree: { path: '/repo' } }),
        branch('feature/a', { worktree: { path: '/tmp/worktree-a' } }),
        branch('feature/b', { worktree: { path: '/tmp/worktree-b' } }),
        branch('feature/plain'),
      ],
    })

    useReposStore.getState().reorderWorktrees(REPO_ID, '/tmp/worktree-b', '/repo')

    expect(useReposStore.getState().repos[REPO_ID]?.ui.worktreePathOrder).toEqual([
      '/tmp/worktree-b',
      '/repo',
      '/tmp/worktree-a',
    ])
    expect(useReposStore.getState().repoCache[REPO_ID]?.ui.worktreePathOrder).toEqual([
      '/tmp/worktree-b',
      '/repo',
      '/tmp/worktree-a',
    ])
  })

  test('ignores stale worktree paths', () => {
    seedRepo({ selectedBranch: 'main' })
    const before = useReposStore.getState().repos[REPO_ID]

    useReposStore.getState().reorderWorktrees(REPO_ID, '/missing', '/repo')

    expect(useReposStore.getState().repos[REPO_ID]).toBe(before)
    expect(useReposStore.getState().repoCache[REPO_ID]).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run:

```bash
bun run test -- src/web/stores/repos/persistence.test.ts src/web/stores/repos/selection.test.ts
```

Expected: FAIL because types, cache schema, test helpers, and `reorderWorktrees` are missing.

- [ ] **Step 3: Add the UI field and test seeding support**

Modify `src/web/stores/repos/types.ts`:

```ts
export interface RepoUiState {
  selectedBranch: string | null
  branchViewMode: BranchViewMode
  detailTab: DetailTab
  worktreePathOrder: string[]
}

export interface CachedRepoState {
  savedAt: number
  name: string
  data: Pick<RepoDataState, 'branches' | 'currentBranch' | 'status' | 'statusLoaded' | 'worktreesByPath'>
  ui: Pick<RepoUiState, 'selectedBranch' | 'branchViewMode' | 'detailTab' | 'worktreePathOrder'>
}
```

Add to `ReposStore`:

```ts
reorderWorktrees: (id: string, fromPath: string, toPath: string) => void
```

Modify `src/web/stores/repos/helpers.ts`:

```ts
ui: {
  selectedBranch: null,
  branchViewMode: 'all',
  detailTab: 'status',
  worktreePathOrder: [],
},
```

Modify `src/web/stores/repos/test-utils.ts` seed options:

```ts
branchViewMode?: RepoState['ui']['branchViewMode']
worktreePathOrder?: string[]
```

and seed `ui` with:

```ts
ui: {
  ...base.ui,
  selectedBranch: options.selectedBranch ?? base.ui.selectedBranch,
  branchViewMode: options.branchViewMode ?? base.ui.branchViewMode,
  detailTab: options.detailTab ?? base.ui.detailTab,
  worktreePathOrder: options.worktreePathOrder ?? base.ui.worktreePathOrder,
},
```

Update the `cachedRepo()` helper in `src/web/stores/repos/persistence.test.ts` so existing tests build valid cache entries:

```ts
ui: {
  selectedBranch: null,
  branchViewMode: 'all',
  detailTab: 'status',
  worktreePathOrder: [],
},
```

- [ ] **Step 4: Persist and hydrate the field**

Modify `src/web/stores/repos/persistence.ts`:

```ts
const CachedRepoSchema = v.object({
  savedAt: FiniteNumber,
  name: v.string(),
  data: v.object({
    branches: v.array(BranchSchema),
    currentBranch: v.string(),
    status: v.array(WorktreeStatusSchema),
    statusLoaded: v.boolean(),
    worktreesByPath: v.optional(v.record(v.string(), WorktreeStateSchema)),
  }),
  ui: v.object({
    selectedBranch: v.nullable(v.string()),
    branchViewMode: v.picklist(['all', 'worktrees', 'no-worktree']),
    detailTab: v.picklist(['status', 'terminal']),
    worktreePathOrder: v.optional(v.array(v.string()), []),
  }),
})
```

In `hydrateCachedRepo()`, set:

```ts
ui: {
  ...repo.ui,
  selectedBranch,
  branchViewMode: cached.ui.branchViewMode,
  detailTab: cached.ui.detailTab === 'terminal' ? 'terminal' : 'status',
  worktreePathOrder: cached.ui.worktreePathOrder,
},
```

In `repoCacheEntry()`, set:

```ts
ui: {
  selectedBranch: repo.ui.selectedBranch,
  branchViewMode: repo.ui.branchViewMode,
  detailTab: repo.ui.detailTab === 'terminal' ? 'terminal' : 'status',
  worktreePathOrder: repo.ui.worktreePathOrder,
},
```

In `normalizeRepoCacheEntry()`, keep the normalized field:

```ts
ui: {
  ...cached.ui,
  detailTab: cached.ui.detailTab === 'terminal' ? 'terminal' : 'status',
  worktreePathOrder: cached.ui.worktreePathOrder,
},
```

- [ ] **Step 5: Implement the store action**

Modify `src/web/stores/repos/selection.ts` import:

```ts
import { arrayMove } from '@dnd-kit/sortable'
import { normalizeWorktreePathOrder, selectedBranchForViewMode } from '#/web/stores/repos/branch-view-mode.ts'
```

Add inside `createSelectionActions()`:

```ts
reorderWorktrees(id: string, fromPath: string, toPath: string) {
  if (fromPath === toPath) return
  let changed = false
  let token: number | undefined
  set((s) => {
    const repo = s.repos[id]
    if (!repo) return s
    const currentPaths = repo.data.branches
      .map((branch) => branch.worktree?.path)
      .filter((path): path is string => !!path)
    if (!currentPaths.includes(fromPath) || !currentPaths.includes(toPath)) return s
    const order = normalizeWorktreePathOrder(repo.ui.worktreePathOrder, currentPaths)
    const from = order.indexOf(fromPath)
    const to = order.indexOf(toPath)
    if (from === -1 || to === -1 || from === to) return s
    const worktreePathOrder = arrayMove(order, from, to)
    changed = true
    token = repo.instanceToken
    return replaceRepoState(s, repo, (r) => {
      r.ui.worktreePathOrder = worktreePathOrder
    })
  })
  const repo = get().repos[id]
  if (changed && token !== undefined && repo) persistRepoCache(set, repo, token)
},
```

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```bash
bun run test -- src/web/stores/repos/branch-view-mode.test.ts src/web/stores/repos/persistence.test.ts src/web/stores/repos/selection.test.ts
bun run typecheck
```

Expected: PASS.

## Task 3: Worktree Directory Row Display

**Files:**
- Modify: `src/web/components/repo-workspace/BranchSummaryInline.tsx`
- Modify: `src/web/components/branch-list/BranchRow.test.tsx`

- [ ] **Step 1: Write failing row display tests**

Add to `src/web/components/branch-list/BranchRow.test.tsx`:

```tsx
test('shows the formatted worktree directory for linked branches', () => {
  const repo = emptyRepo('/tmp/repo', 'repo')
  const branch = createRepoBranch('feature/a', { worktree: { path: '/tmp/worktree-a' } })

  render(
    <ul>
      <BranchRow
        repo={repo}
        branch={branch}
        selected={null}
        onSelectBranch={vi.fn()}
        onOpenBranchStatus={vi.fn()}
        selectedRef={createRef<HTMLLIElement>()}
        showActions={false}
      />
    </ul>,
  )

  expect(document.body.textContent).toContain('/tmp/worktree-a')
})

test('does not add a directory line for branches without worktrees', () => {
  const repo = emptyRepo('/tmp/repo', 'repo')
  const branch = createRepoBranch('feature/plain')

  render(
    <ul>
      <BranchRow
        repo={repo}
        branch={branch}
        selected={null}
        onSelectBranch={vi.fn()}
        onOpenBranchStatus={vi.fn()}
        selectedRef={createRef<HTMLLIElement>()}
        showActions={false}
      />
    </ul>,
  )

  expect(document.body.textContent).not.toContain('没有工作树')
  expect(document.body.textContent).not.toContain('no worktree')
})
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
bun run test -- src/web/components/branch-list/BranchRow.test.tsx
```

Expected: FAIL because linked branch rows do not render the directory yet.

- [ ] **Step 3: Render directory line in `BranchSummaryInline`**

Modify imports in `src/web/components/repo-workspace/BranchSummaryInline.tsx`:

```ts
import { formatWorktreeListPath } from '#/web/lib/paths.ts'
```

Inside `BranchSummaryInline()` add:

```ts
const worktreePath = branch.worktree?.path ? formatWorktreeListPath(branch.worktree.path, repo.remote?.target) : null
```

This list-specific formatter keeps local paths home-relative where applicable and shows only the remote filesystem path for remote repositories. It must not add `user@host:` or host/IP prefix text in the branch/worktree list.

Add `worktreePath` to the title array after the worktree badge entry:

```ts
worktreePath,
```

Replace the returned root structure with this shape:

```tsx
return (
  <div title={title} className={cn('flex min-w-0 flex-col gap-0.5', className)}>
    <div className="flex min-w-0 items-center gap-2">
      <span className="flex w-4 shrink-0 items-center justify-center">
        {isCurrent ? (
          <Check size={14} className="text-success" />
        ) : isWorktree ? (
          <FolderTree size={14} className={worktreeDirty ? 'text-attention' : 'text-brand-text'} />
        ) : (
          <GitBranch size={14} className={selected ? 'text-selected-muted-foreground' : 'text-muted-foreground'} />
        )}
      </span>
      <span className="flex min-w-0 items-center gap-2 overflow-hidden">
        <span className={cn('shrink-0 truncate text-sm font-medium', selected ? 'text-selected-foreground' : 'text-foreground')}>
          {branch.name}
        </span>
        <span
          className={cn(
            'flex min-w-0 items-center gap-1.5 overflow-hidden text-xs',
            selected ? 'text-selected-muted-foreground' : 'text-muted-foreground',
          )}
        >
          {branch.isDefault && (
            <Badge variant="outline" className="text-muted-foreground">
              {t('branches.default')}
            </Badge>
          )}
          {hasWorktree && worktreeDirty ? (
            <Badge variant="attention" className="gap-1">
              <FolderTree size={10} />
              {t('branches.dirty')}
            </Badge>
          ) : isWorktree ? (
            <Badge variant="outline" className="gap-1 text-muted-foreground">
              <FolderTree size={10} />
              {t('branches.worktree')}
            </Badge>
          ) : null}
          {branch.trackingGone && <Badge variant="attention">{t('branches.gone')}</Badge>}
          {branch.ahead > 0 && (
            <Delta direction="ahead" count={branch.ahead} label={t('branch-status.sync.ahead', { n: branch.ahead })} />
          )}
          {branch.behind > 0 && (
            <Delta direction="behind" count={branch.behind} label={t('branch-status.sync.behind', { n: branch.behind })} />
          )}
          {commitMeta && (
            <span
              className={cn(
                'min-w-0 truncate whitespace-nowrap text-[11px] leading-none',
                selected ? 'text-selected-muted-foreground/90' : 'text-muted-foreground/85',
              )}
              title={commitMeta}
            >
              {commitMeta}
            </span>
          )}
        </span>
      </span>
    </div>
    {worktreePath && (
      <span
        title={worktreePath}
        aria-label={worktreePath}
        className={cn(
          'block min-w-0 truncate pl-6 font-mono text-[11px] leading-none',
          selected ? 'text-selected-muted-foreground/90' : 'text-muted-foreground/85',
        )}
      >
        {worktreePath}
      </span>
    )}
  </div>
)
```

- [ ] **Step 4: Run row tests**

Run:

```bash
bun run test -- src/web/components/branch-list/BranchRow.test.tsx
```

Expected: PASS.

## Task 4: Drag Handle And BranchList DnD Wiring

**Files:**
- Modify: `src/shared/i18n/en.ts`
- Modify: `src/shared/i18n/zh.ts`
- Modify: `src/shared/i18n/ja.ts`
- Modify: `src/shared/i18n/ko.ts`
- Modify: `src/web/components/branch-list/BranchRow.tsx`
- Modify: `src/web/components/branch-list/BranchRow.test.tsx`
- Modify: `src/web/components/BranchList.tsx`
- Create: `src/web/components/BranchList.test.tsx`

- [ ] **Step 1: Add failing drag handle tests for `BranchRow`**

Add to the i18n mock in `src/web/components/branch-list/BranchRow.test.tsx`:

```ts
case 'branches.reorder-worktree':
  return '重新排序工作树'
```

Add this test:

```tsx
test('renders an isolated drag handle when drag props are provided', () => {
  const repo = emptyRepo('/tmp/repo', 'repo')
  const branch = createRepoBranch('feature/a', { worktree: { path: '/tmp/worktree-a' } })

  render(
    <ul>
      <BranchRow
        repo={repo}
        branch={branch}
        selected={null}
        onSelectBranch={vi.fn()}
        onOpenBranchStatus={vi.fn()}
        selectedRef={createRef<HTMLLIElement>()}
        showActions={false}
        dragHandle={{
          label: '重新排序工作树',
          ref: vi.fn(),
          props: { 'data-testid': 'drag-handle' },
        }}
      />
    </ul>,
  )

  const handle = document.querySelector('[data-testid="drag-handle"]')
  expect(handle?.getAttribute('aria-label')).toBe('重新排序工作树')
})
```

- [ ] **Step 2: Run row test and verify it fails**

Run:

```bash
bun run test -- src/web/components/branch-list/BranchRow.test.tsx
```

Expected: FAIL because `BranchRow` has no `dragHandle` prop.

- [ ] **Step 3: Implement optional drag props in `BranchRow`**

Modify `src/web/components/branch-list/BranchRow.tsx` imports:

```ts
import { type CSSProperties, type HTMLAttributes, type RefObject, useCallback } from 'react'
import { GripVertical } from 'lucide-react'
```

Add types:

```ts
interface BranchRowDragHandle {
  label: string
  ref: (node: HTMLButtonElement | null) => void
  props: HTMLAttributes<HTMLButtonElement>
}

interface BranchRowSortable {
  setNodeRef: (node: HTMLLIElement | null) => void
  style?: CSSProperties
  isDragging?: boolean
}
```

Add props:

```ts
dragHandle?: BranchRowDragHandle
sortable?: BranchRowSortable
```

Inside `BranchRow()` add:

```ts
const setItemRef = useCallback(
  (node: HTMLLIElement | null) => {
    if (isSelected) {
      ;(selectedRef as { current: HTMLLIElement | null }).current = node
    }
    sortable?.setNodeRef(node)
  },
  [isSelected, selectedRef, sortable],
)
```

Use `ref={sortable || isSelected ? setItemRef : undefined}` and `style={sortable?.style}` on the `<li>`.

Update the row class grid columns:

```ts
dragHandle
  ? showActions
    ? 'grid-cols-[2rem_minmax(0,1fr)_auto]'
    : 'grid-cols-[2rem_minmax(0,1fr)]'
  : showActions
    ? 'grid-cols-[minmax(0,1fr)_auto]'
    : 'grid-cols-1'
```

Add before the summary cell:

```tsx
{dragHandle && (
  <div className="relative z-20 flex items-center justify-center py-1.5 pl-2">
    <button
      ref={dragHandle.ref}
      type="button"
      aria-label={dragHandle.label}
      title={dragHandle.label}
      {...dragHandle.props}
      onClick={(event) => {
        event.stopPropagation()
        dragHandle.props.onClick?.(event)
      }}
      onDoubleClick={(event) => {
        event.stopPropagation()
        dragHandle.props.onDoubleClick?.(event)
      }}
      className={cn(
        'flex size-6 touch-none cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground active:cursor-grabbing',
        dragHandle.props.className,
      )}
    >
      <GripVertical size={14} />
    </button>
  </div>
)}
```

Add `sortable?.isDragging && 'z-10 bg-card text-foreground shadow-sm'` to the row class list.

- [ ] **Step 4: Add i18n label**

Add this key near the existing branch list keys:

```ts
'branches.reorder-worktree': 'Reorder worktree',
```

Translations:

```ts
// zh
'branches.reorder-worktree': '重新排序工作树',

// ja
'branches.reorder-worktree': 'ワークツリーを並べ替え',

// ko
'branches.reorder-worktree': '워크트리 순서 변경',
```

- [ ] **Step 5: Write failing `BranchList` drag condition tests**

Create `src/web/components/BranchList.test.tsx`:

```tsx
// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { BranchList } from '#/web/components/BranchList.tsx'
import { createRepoBranch, installGoblinTestBridge, resetReposStore, seedRepoState } from '#/web/stores/repos/test-utils.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'

const REPO_ID = '/tmp/repo'
let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const dndState = vi.hoisted(() => ({
  lastDragEnd: null as ((event: { active: { id: string }; over: { id: string } | null }) => void) | null,
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
    DndContext: ({ children, onDragEnd }: { children: ReactNode; onDragEnd: typeof dndState.lastDragEnd }) => {
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
  dndState.lastDragEnd = null
  resetReposStore()
  installGoblinTestBridge({ 'repo.pullRequests': async () => [], 'repo.status': async () => [] })
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  document.body.innerHTML = ''
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
```

- [ ] **Step 6: Run BranchList test and verify it fails**

Run:

```bash
bun run test -- src/web/components/BranchList.test.tsx
```

Expected: FAIL because `BranchList` has no dnd-kit wiring yet.

- [ ] **Step 7: Wire dnd-kit in `BranchList`**

Modify imports in `src/web/components/BranchList.tsx`:

```ts
import { type ComponentProps, useCallback, useEffect, useRef, useState } from 'react'
import {
  DndContext,
  type DragEndEvent,
  type Modifier,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
```

Add a vertical modifier near the top:

```ts
const restrictToVerticalBranchList: Modifier = ({ transform }) => ({ ...transform, x: 0 })
```

Inside `BranchList()` add:

```ts
const reorderWorktrees = useReposStore((s) => s.reorderWorktrees)
const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
```

Include `worktreePathOrder` in `BranchListRepo.ui` and `branchListRepoEqual`.

Call `visibleBranches()` with:

```ts
worktreePathOrder: repo.ui.worktreePathOrder,
```

Add:

```ts
const dragEnabled = repo.ui.branchViewMode === 'worktrees' && branchSearchQuery.trim() === ''
const sortableWorktreePaths = dragEnabled
  ? branches.map((branch) => branch.worktree?.path).filter((path): path is string => !!path)
  : []

const handleDragEnd = (event: DragEndEvent) => {
  const { active, over } = event
  if (!over || active.id === over.id) return
  reorderWorktrees(repoId, String(active.id), String(over.id))
}
```

Create a local sortable row helper in the same file:

```tsx
function SortableBranchRow(props: ComponentProps<typeof BranchRow> & { id: string; dragHandleLabel: string }) {
  const { id, dragHandleLabel, ...rowProps } = props
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  })
  const verticalTransform = transform ? { ...transform, x: 0, scaleX: 1, scaleY: 1 } : null
  return (
    <BranchRow
      {...rowProps}
      sortable={{
        setNodeRef,
        style: {
          transform: CSS.Transform.toString(verticalTransform),
          transition,
        },
        isDragging,
      }}
      dragHandle={{
        label: dragHandleLabel,
        ref: setActivatorNodeRef,
        props: { ...attributes, ...listeners },
      }}
    />
  )
}
```

Render rows with:

```tsx
const rows = branches.map((branch) => {
  const rowProps = {
    key: branch.name,
    repo,
    branch,
    selected: repo.ui.selectedBranch,
    onSelectBranch: handleSelectBranch,
    onOpenBranchStatus: handleOpenBranchStatus,
    selectedRef,
    showActions,
    actionMenuOpen: openActionMenu?.repoId === repoId && openActionMenu.branch === branch.name,
    onActionMenuOpenChange: (open: boolean) =>
      setOpenActionMenu((current) =>
        open
          ? { repoId, branch: branch.name }
          : current?.repoId === repoId && current.branch === branch.name
            ? null
            : current,
      ),
  }
  return dragEnabled && branch.worktree?.path ? (
    <SortableBranchRow
      {...rowProps}
      key={branch.name}
      id={branch.worktree.path}
      dragHandleLabel={t('branches.reorder-worktree')}
    />
  ) : (
    <BranchRow {...rowProps} key={branch.name} />
  )
})
```

Wrap the branch rows only when dragging is enabled:

```tsx
{dragEnabled ? (
  <DndContext
    sensors={sensors}
    collisionDetection={closestCenter}
    modifiers={[restrictToVerticalBranchList]}
    onDragEnd={handleDragEnd}
  >
    <SortableContext items={sortableWorktreePaths} strategy={verticalListSortingStrategy}>
      {rows}
    </SortableContext>
  </DndContext>
) : (
  rows
)}
```

Keep the detached worktree section outside `SortableContext`.

- [ ] **Step 8: Run component tests**

Run:

```bash
bun run test -- src/web/components/branch-list/BranchRow.test.tsx src/web/components/BranchList.test.tsx
```

Expected: PASS.

## Task 5: Final Integration Verification

**Files:**
- No new source files unless prior tasks expose a type or lint issue.

- [ ] **Step 1: Run focused test set**

Run:

```bash
bun run test -- src/web/stores/repos/branch-view-mode.test.ts src/web/stores/repos/persistence.test.ts src/web/stores/repos/selection.test.ts src/web/components/branch-list/BranchRow.test.tsx src/web/components/BranchList.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run full typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run full test suite**

Run:

```bash
bun run test
```

Expected: PASS.

- [ ] **Step 4: Run architecture guard**

Run:

```bash
bun run check:architecture
```

Expected: PASS.

- [ ] **Step 5: Manual UI verification**

Start the app with the repo's normal dev command:

```bash
bun run dev
```

Verify these behaviors in a repository with at least two linked worktrees:

- All view shows worktree directory lines for linked worktree branches.
- Worktrees view shows the same directory lines.
- No Worktree view keeps ordinary branch rows without an empty directory line.
- Worktrees view with an empty search query shows drag handles.
- Dragging a worktree row above another row updates the visible Worktrees order.
- All view reflects the saved worktree order and does not show drag handles.
- Entering search text hides drag handles while preserving directory display.
- Reloading the app restores order while the repo cache remains valid.
