// Persistent branch list. Each row shows branch name, lightweight
// scan signals, and the head commit subject, author, and relative date. The
// selected row scrolls into view automatically when the user moves with
// j/k or arrows so a long branch list doesn't strand the cursor offscreen.
//
// Worktree branches use a folder-tree glyph and a compact chip beside the
// name. We avoid tinting the whole row so selection, hover, and status
// semantics don't compete for background colour.

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
import { FolderTree, GitCommitHorizontal } from 'lucide-react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useT } from '#/web/stores/i18n.ts'
import { visibleBranches } from '#/web/stores/repos/branch-view-mode.ts'
import { BranchRow } from '#/web/components/branch-list/BranchRow.tsx'
import { EmptyState } from '#/web/components/Layout.tsx'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { Badge } from '#/web/components/ui/badge.tsx'
import { useMainWindowNavigation } from '#/web/main-window-navigation.tsx'
import type { BranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import type { RepoBranchState, RepoWorktreeState } from '#/web/stores/repos/types.ts'
import { formatWorktreeListPath } from '#/web/lib/paths.ts'
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'

interface Props {
  repoId: string
  showActions?: boolean
}

type OpenActionMenu = { repoId: string; branch: string }

type BranchListRepo = BranchActionRepo & {
  data: BranchActionRepo['data'] & {
    branches: RepoBranchState[]
  }
  ui: {
    selectedBranch: string | null
    branchViewMode: 'all' | 'worktrees' | 'no-worktree'
    worktreePathOrder: string[]
  }
}

const restrictToVerticalBranchList: Modifier = ({ transform }) => ({ ...transform, x: 0 })

function branchListRepoEqual(a: BranchListRepo | undefined, b: BranchListRepo | undefined): boolean {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.id === b.id &&
      a.instanceToken === b.instanceToken &&
      a.data.branches === b.data.branches &&
      a.data.currentBranch === b.data.currentBranch &&
      a.data.status === b.data.status &&
      a.data.worktreesByPath === b.data.worktreesByPath &&
      a.ui.selectedBranch === b.ui.selectedBranch &&
      a.ui.branchViewMode === b.ui.branchViewMode &&
      a.ui.worktreePathOrder === b.ui.worktreePathOrder &&
      a.operations.branchAction === b.operations.branchAction &&
      a.remote.target === b.remote.target &&
      a.remote.hasRemotes === b.remote.hasRemotes &&
      a.remote.hasBrowserRemote === b.remote.hasBrowserRemote &&
      a.remote.hasGitHubRemote === b.remote.hasGitHubRemote &&
      a.remote.browserRemoteProvider === b.remote.browserRemoteProvider &&
      a.remote.remoteProviders === b.remote.remoteProviders)
  )
}

export function BranchList({ repoId, showActions = true }: Props) {
  const t = useT()
  const setDetailCollapsed = useReposStore((s) => s.setDetailCollapsed)
  const reorderWorktrees = useReposStore((s) => s.reorderWorktrees)
  const navigation = useMainWindowNavigation()
  const selectedRef = useRef<HTMLLIElement | null>(null)
  const [openActionMenu, setOpenActionMenu] = useState<OpenActionMenu | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const handleSelectBranch = useCallback(
    (branch: string) => {
      navigation.selectRepoBranch(repoId, branch)
    },
    [navigation, repoId],
  )
  const handleOpenBranchStatus = useCallback(
    (branch: string) => {
      handleSelectBranch(branch)
      navigation.showRepoDetailTab(repoId, 'status')
      setDetailCollapsed(false)
    },
    [repoId, handleSelectBranch, navigation, setDetailCollapsed],
  )
  const branchSearchQuery = useReposStore((s) => s.branchSearchQueries[repoId] ?? '')
  const repo = useStoreWithEqualityFn(
    useReposStore,
    (s) => {
      const repo = s.repos[repoId]
      return repo
        ? {
            id: repo.id,
            instanceToken: repo.instanceToken,
            data: {
              branches: repo.data.branches,
              currentBranch: repo.data.currentBranch,
              status: repo.data.status,
              worktreesByPath: repo.data.worktreesByPath,
            },
            ui: {
              selectedBranch: repo.ui.selectedBranch,
              branchViewMode: repo.ui.branchViewMode,
              worktreePathOrder: repo.ui.worktreePathOrder,
            },
            operations: {
              branchAction: repo.operations.branchAction,
            },
            remote: {
              target: repo.remote.target,
              hasRemotes: repo.remote.hasRemotes,
              hasBrowserRemote: repo.remote.hasBrowserRemote,
              hasGitHubRemote: repo.remote.hasGitHubRemote,
              browserRemoteProvider: repo.remote.browserRemoteProvider,
              remoteProviders: repo.remote.remoteProviders,
            },
          }
        : undefined
    },
    branchListRepoEqual,
  )

  // Keep the selected row in view as the user navigates with j/k.
  useEffect(() => {
    const selectedEl = selectedRef.current
    if (selectedEl) selectedEl.scrollIntoView({ block: 'nearest' })
  }, [repo?.ui.selectedBranch])

  if (!repo) return null

  const branches = visibleBranches({
    branches: repo.data.branches,
    viewMode: repo.ui.branchViewMode,
    searchQuery: branchSearchQuery,
    worktreePathOrder: repo.ui.worktreePathOrder,
  })
  const dragEnabled = repo.ui.branchViewMode === 'worktrees' && branchSearchQuery.trim() === ''
  const sortableWorktreePaths = dragEnabled
    ? branches.map((branch) => branch.worktree?.path).filter((path): path is string => !!path)
    : []
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    reorderWorktrees(repoId, String(active.id), String(over.id))
  }
  const detachedWorktrees = repo.ui.branchViewMode === 'no-worktree'
    ? []
    : Object.values(repo.data.worktreesByPath)
        .filter((worktree) => worktree.isDetached)
        .filter((worktree) => detachedWorktreeMatchesSearch(worktree, branchSearchQuery, repo.remote.target))
  useEffect(() => {
    if (!openActionMenu) return
    if (openActionMenu.repoId !== repoId || !showActions || !branches.some((branch) => branch.name === openActionMenu.branch)) {
      setOpenActionMenu(null)
    }
  }, [openActionMenu, branches, repoId, showActions])

  if (branches.length === 0 && detachedWorktrees.length === 0) {
    return <EmptyState title={t(repo.data.branches.length === 0 ? 'branches.empty' : 'branches.filter-empty')} />
  }

  const rows = branches.map((branch) => {
    const rowProps = {
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

  const list = (
    <ul>
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
      {detachedWorktrees.length > 0 && (
        <>
          <li className="px-4 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('branches.detached-worktrees')}
          </li>
          {detachedWorktrees.map((worktree) => (
            <DetachedWorktreeRow
              key={worktree.path}
              worktree={worktree}
              remoteTarget={repo.remote.target}
            />
          ))}
        </>
      )}
    </ul>
  )

  return <ScrollArea className="min-h-0 flex-1">{list}</ScrollArea>
}

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

function detachedWorktreeMatchesSearch(
  worktree: RepoWorktreeState,
  searchQuery: string,
  remoteTarget?: RemoteRepoTarget,
): boolean {
  const query = searchQuery.trim().toLowerCase()
  if (!query) return true
  const displayPath = formatWorktreeListPath(worktree.path, remoteTarget).toLowerCase()
  return displayPath.includes(query) || (worktree.head ?? '').toLowerCase().includes(query)
}

function DetachedWorktreeRow({
  worktree,
  remoteTarget,
}: {
  worktree: RepoWorktreeState
  remoteTarget?: RemoteRepoTarget
}) {
  const t = useT()
  const displayPath = formatWorktreeListPath(worktree.path, remoteTarget)
  const head = worktree.head ? worktree.head.slice(0, 12) : t('branches.detached-head')
  const dirty = worktree.isDirty || (worktree.changeCount ?? 0) > 0
  const title = [
    t('branches.detached-worktree'),
    worktree.head ?? null,
    displayPath,
    dirty ? t('branches.dirty') : null,
  ].filter(Boolean).join(', ')

  return (
    <li
      title={title}
      className="relative grid min-h-9 grid-cols-1 items-stretch text-muted-foreground transition-colors duration-100 hover:bg-muted"
    >
      <div className="pointer-events-none relative z-10 flex min-w-0 items-center gap-2 px-4 py-1.5">
        <span className="flex w-4 shrink-0 items-center justify-center">
          <GitCommitHorizontal size={14} className={dirty ? 'text-attention' : 'text-muted-foreground'} />
        </span>
        <span className="flex min-w-0 items-center gap-2 overflow-hidden">
          <span className="shrink-0 truncate font-mono text-sm text-foreground">{head}</span>
          <Badge variant={dirty ? 'attention' : 'outline'} className="gap-1">
            <FolderTree size={10} />
            {dirty ? t('branches.dirty') : t('branches.detached')}
          </Badge>
          <span className="min-w-0 truncate text-[11px] leading-none text-muted-foreground/85">
            {displayPath}
          </span>
        </span>
      </div>
    </li>
  )
}
