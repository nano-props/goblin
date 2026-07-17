// Read-only file tree view for the worktree-scoped file tree
// (docs/filetree.md).

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type UIEvent,
} from 'react'
import { type Key } from 'react-aria-components'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronRight, File, Folder, FolderTree, Loader2, Trash2 } from 'lucide-react'
import type { RepoTreeNode } from '#/shared/api-types.ts'
import type { LazyRepoTreeAggregate } from '#/web/filetree-lazy-state.ts'
import { useT } from '#/web/stores/i18n.ts'
import { EmptyState } from '#/web/components/Layout.tsx'
import { ActionPopover, ActionPopoverItem } from '#/web/components/ActionPopover.tsx'
import { focusRingInset } from '#/web/components/ui/focus.ts'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { buildFiletreeCollection, type FiletreeRow } from '#/web/components/repo-workspace/filetree-collection.ts'
import { useRestoreTopVisibleRowIndex } from '#/web/hooks/useRestoreTopVisibleRowIndex.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { cn } from '#/web/lib/cn.ts'

export interface FiletreeViewProps {
  readonly tree: LazyRepoTreeAggregate | null
  readonly loading: boolean
  readonly loadingKeys?: ReadonlySet<string>
  readonly openingFileKeys?: ReadonlySet<string>
  readonly error: string | null
  readonly onSelect?: (node: RepoTreeNode) => void
  readonly onActivate?: (node: RepoTreeNode) => void
  readonly onOpenFile?: (node: RepoTreeNode) => void
  readonly onRequestTrashFile?: (node: RepoTreeNode) => void
  readonly selectedKeys: ReadonlySet<Key>
  readonly expandedKeys: ReadonlySet<Key>
  readonly onSelectedKeysChange: (keys: Set<Key>) => void
  readonly onDirectoryRowToggle: (key: string, expanded: boolean) => void
  readonly onPruneKeys: (validKeys: ReadonlySet<string>) => void
  readonly initialTopVisibleRowIndex: number
  readonly scrollRestoreKey: string
  readonly scrollRestoreReady: boolean
  readonly onTopVisibleRowIndexChange: (topVisibleRowIndex: number) => void
}

const FILE_TREE_I18N_KEYS = {
  ariaLabel: 'filetree.aria-label',
  empty: 'filetree.empty',
  loading: 'filetree.loading',
  noWorktreeTitle: 'filetree.no-worktree-title',
  noWorktreeBody: 'filetree.no-worktree-body',
  truncated: 'filetree.truncated',
  error: 'filetree.error',
  open: 'app-chrome.open',
  delete: 'menu.edit.delete',
  actionMenu: 'action.menu',
} as const satisfies Record<string, string>

const FILETREE_ROW_HEIGHT = 24

function firstStringKey(keys: ReadonlySet<Key>): string | null {
  for (const key of keys) {
    if (typeof key === 'string') return key
  }
  return null
}

function focusRowAtIndex(
  viewport: HTMLElement | null,
  virtualizer: { scrollToIndex: (index: number) => void },
  index: number,
): void {
  if (!viewport || index < 0) return
  const selector = `[data-filetree-row-index="${index}"]`
  const mountedRow = viewport.querySelector<HTMLElement>(selector)
  if (mountedRow) {
    mountedRow.focus()
    return
  }
  virtualizer.scrollToIndex(index)
  requestAnimationFrame(() => {
    viewport.querySelector<HTMLElement>(selector)?.focus()
  })
}

function findTypeaheadRowIndex(rows: ReadonlyArray<FiletreeRow>, currentIndex: number, key: string): number {
  const needle = key.toLocaleLowerCase()
  if (!needle) return -1
  for (let offset = 1; offset <= rows.length; offset += 1) {
    const index = (Math.max(0, currentIndex) + offset) % rows.length
    if (rows[index]?.node.name.toLocaleLowerCase().startsWith(needle)) return index
  }
  return -1
}

export function FiletreeView({
  tree,
  loading,
  loadingKeys = new Set(),
  openingFileKeys = new Set(),
  error,
  onSelect,
  onActivate,
  onOpenFile,
  onRequestTrashFile,
  selectedKeys,
  expandedKeys,
  onSelectedKeysChange,
  onDirectoryRowToggle,
  onPruneKeys,
  initialTopVisibleRowIndex,
  scrollRestoreKey,
  scrollRestoreReady,
  onTopVisibleRowIndexChange,
}: FiletreeViewProps) {
  const t = useT()
  const collection = useMemo(() => buildFiletreeCollection(tree, expandedKeys), [expandedKeys, tree])
  const scrollViewportRef = useRef<HTMLDivElement | null>(null)
  const rowVirtualizer = useVirtualizer({
    count: collection.rows.length,
    getScrollElement: () => scrollViewportRef.current,
    estimateSize: () => FILETREE_ROW_HEIGHT,
    overscan: 12,
    getItemKey: (index) => collection.rows[index]?.id ?? index,
    initialRect: { width: 800, height: 100_000 },
  })
  const virtualRows = rowVirtualizer.getVirtualItems()
  const renderedRows =
    virtualRows.length > 0
      ? virtualRows
      : collection.rows.map((row, index) => ({ key: row.id, index, start: index * FILETREE_ROW_HEIGHT }))
  const selectedKey = firstStringKey(selectedKeys)
  const selectedIndex = selectedKey ? collection.rows.findIndex((row) => row.id === selectedKey) : -1
  const tabbableIndex = selectedIndex >= 0 ? selectedIndex : 0

  useEffect(() => {
    if (!tree) return
    onPruneKeys(new Set(collection.byId.keys()))
  }, [collection, onPruneKeys, tree])

  useRestoreTopVisibleRowIndex({
    restoreKey: scrollRestoreKey,
    topVisibleRowIndex: initialTopVisibleRowIndex,
    enabled: tree !== null,
    ready: scrollRestoreReady,
    rowCount: collection.rows.length,
    virtualizer: rowVirtualizer,
  })

  const selectNode = useCallback(
    (node: RepoTreeNode) => {
      onSelectedKeysChange(new Set<Key>([node.id]))
      onSelect?.(node)
    },
    [onSelect, onSelectedKeysChange],
  )

  const handleRowPress = useCallback(
    (node: RepoTreeNode, isExpanded: boolean) => {
      selectNode(node)
      if (node.kind !== 'directory') return
      onDirectoryRowToggle(node.id, !isExpanded)
    },
    [onDirectoryRowToggle, selectNode],
  )

  const handleOpenFile = useCallback(
    (node: RepoTreeNode) => {
      if (node.kind !== 'file') return
      onOpenFile?.(node)
      onActivate?.(node)
    },
    [onActivate, onOpenFile],
  )

  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      onTopVisibleRowIndexChange(topVisibleRowIndexFromViewport(event.currentTarget))
    },
    [onTopVisibleRowIndexChange],
  )

  const handleRowKeyDown = useCallback(
    (node: RepoTreeNode, event: KeyboardEvent<HTMLDivElement>) => {
      const rowIndex = collection.rows.findIndex((row) => row.id === node.id)
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        focusRowAtIndex(scrollViewportRef.current, rowVirtualizer, Math.min(collection.rows.length - 1, rowIndex + 1))
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        focusRowAtIndex(scrollViewportRef.current, rowVirtualizer, Math.max(0, rowIndex - 1))
        return
      }
      if (event.key === 'Home') {
        event.preventDefault()
        focusRowAtIndex(scrollViewportRef.current, rowVirtualizer, 0)
        return
      }
      if (event.key === 'End') {
        event.preventDefault()
        focusRowAtIndex(scrollViewportRef.current, rowVirtualizer, collection.rows.length - 1)
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        if (node.kind === 'file') handleOpenFile(node)
        return
      }
      if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const matchIndex = findTypeaheadRowIndex(collection.rows, rowIndex, event.key)
        if (matchIndex >= 0) {
          event.preventDefault()
          focusRowAtIndex(scrollViewportRef.current, rowVirtualizer, matchIndex)
        }
        return
      }
      if (node.kind !== 'directory') return
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        if (!expandedKeys.has(node.id)) onDirectoryRowToggle(node.id, true)
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        if (expandedKeys.has(node.id)) onDirectoryRowToggle(node.id, false)
      }
    },
    [collection.rows, expandedKeys, handleOpenFile, onDirectoryRowToggle, rowVirtualizer],
  )

  if (error) {
    return (
      <FiletreeShell loading={loading}>
        <EmptyState icon={<FolderTree size={16} />} title={t(FILE_TREE_I18N_KEYS.error)} />
      </FiletreeShell>
    )
  }

  if (!tree) {
    if (loading) {
      return <FiletreeShell loading={loading} />
    }
    return (
      <FiletreeShell loading={loading}>
        <EmptyState icon={<FolderTree size={16} />} title={t(FILE_TREE_I18N_KEYS.empty)} />
      </FiletreeShell>
    )
  }

  if (collection.rows.length === 0) {
    return (
      <FiletreeShell loading={loading}>
        <EmptyState icon={<FolderTree size={16} />} title={t(FILE_TREE_I18N_KEYS.empty)} />
      </FiletreeShell>
    )
  }

  return (
    <FiletreeShell loading={loading}>
      <ScrollArea
        className="min-h-0 flex-1"
        scrollbarMode="compact"
        viewportRef={scrollViewportRef}
        viewportClassName={focusRingInset}
        viewportOnScroll={handleScroll}
      >
        <div
          role="tree"
          aria-label={t(FILE_TREE_I18N_KEYS.ariaLabel)}
          className="relative min-h-full font-sans text-sm"
          style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
        >
          {renderedRows.map((virtualRow) => {
            const row = collection.rows[virtualRow.index]
            if (!row) return null
            const childIds = collection.childIdsByParentId.get(row.id) ?? []
            return (
              <FiletreeTreeRow
                key={row.id}
                row={row}
                rowIndex={virtualRow.index}
                hasChildItems={row.node.kind === 'directory' && (row.node.hasChildren === true || childIds.length > 0)}
                isExpanded={expandedKeys.has(row.id)}
                isSelected={selectedKeys.has(row.id)}
                isTabbable={virtualRow.index === tabbableIndex}
                isLoading={loadingKeys.has(row.id)}
                isOpeningFile={openingFileKeys.has(row.id)}
                virtualStart={virtualRow.start}
                onKeyDown={handleRowKeyDown}
                onRowClick={handleRowPress}
                onToggleDirectory={onDirectoryRowToggle}
                onSelect={selectNode}
                onOpenFile={onOpenFile || onActivate ? handleOpenFile : undefined}
                onRequestTrashFile={onRequestTrashFile}
              />
            )
          })}
        </div>
      </ScrollArea>
      {tree.truncated ? (
        <div className="border-t border-border bg-muted px-4 py-1 text-xs text-muted-foreground">
          {t(FILE_TREE_I18N_KEYS.truncated)}
        </div>
      ) : null}
    </FiletreeShell>
  )
}

function FiletreeShell({ loading, children }: { readonly loading: boolean; readonly children?: ReactNode }) {
  return (
    <div data-filetree="" aria-busy={loading || undefined} className="flex min-h-0 flex-1 flex-col">
      {children}
    </div>
  )
}

function FiletreeTreeRow({
  row,
  rowIndex,
  hasChildItems,
  isExpanded,
  isSelected,
  isTabbable,
  isLoading,
  isOpeningFile,
  virtualStart,
  onKeyDown,
  onRowClick,
  onToggleDirectory,
  onSelect,
  onOpenFile,
  onRequestTrashFile,
}: {
  readonly row: FiletreeRow
  readonly rowIndex: number
  readonly hasChildItems: boolean
  readonly isExpanded: boolean
  readonly isSelected: boolean
  readonly isTabbable: boolean
  readonly isLoading: boolean
  readonly isOpeningFile: boolean
  readonly virtualStart: number
  readonly onKeyDown: (node: RepoTreeNode, event: KeyboardEvent<HTMLDivElement>) => void
  readonly onRowClick: (node: RepoTreeNode, isExpanded: boolean) => void
  readonly onToggleDirectory: (key: string, expanded: boolean) => void
  readonly onSelect: (node: RepoTreeNode) => void
  readonly onOpenFile?: (node: RepoTreeNode) => void
  readonly onRequestTrashFile?: (node: RepoTreeNode) => void
}) {
  const { node, level } = row
  const isDirectory = node.kind === 'directory'

  return (
    <div
      role="treeitem"
      aria-label={node.name}
      aria-level={level}
      aria-posinset={row.posInSet}
      aria-setsize={row.setSize}
      aria-selected={isSelected}
      aria-expanded={isDirectory ? isExpanded : undefined}
      tabIndex={isTabbable ? 0 : -1}
      data-filetree-row=""
      data-filetree-row-index={rowIndex}
      className={cn(
        'group/filetree-row absolute left-0 top-0 w-full cursor-pointer text-foreground outline-none transition-colors duration-100',
        !isSelected && 'hover:bg-muted focus:bg-muted active:bg-muted',
        isSelected && 'bg-selected text-selected-foreground',
        'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
      )}
      style={{
        transform: `translateY(${virtualStart}px)`,
      }}
      onClick={(event) => handleTreeItemClick(event, node, isExpanded, onRowClick)}
      onDoubleClick={onOpenFile ? (event) => handleItemDoubleClick(event, node, onOpenFile) : undefined}
      onKeyDown={(event) => onKeyDown(node, event)}
    >
      <div
        className="flex w-full min-w-0 items-center gap-1 py-0.5 pl-1.5 pr-3"
        style={{ paddingLeft: `${(level - 1) * 12 + 6}px` }}
      >
        <span className="flex w-3 shrink-0 items-center justify-center text-muted-foreground">
          {hasChildItems ? (
            <button
              type="button"
              slot="chevron"
              className="flex size-3 items-center justify-center rounded-sm outline-none"
              onClick={(event) => {
                event.stopPropagation()
                onToggleDirectory(node.id, !isExpanded)
              }}
              aria-label={node.name}
            >
              {isLoading ? (
                <Loader2 size={11} aria-hidden className="animate-spin" />
              ) : (
                <ChevronRight
                  size={12}
                  aria-hidden
                  className={cn('transition-transform', isExpanded ? 'rotate-90' : 'rotate-0')}
                />
              )}
            </button>
          ) : null}
        </span>
        <span className="flex w-3.5 shrink-0 items-center justify-center text-muted-foreground">
          {isDirectory ? <Folder size={12} aria-hidden /> : <File size={12} aria-hidden />}
        </span>
        <span className="min-w-0 flex-1 truncate text-current">{node.name}</span>
        {!isDirectory && (onOpenFile || onRequestTrashFile) ? (
          <FiletreeActionMenu
            node={node}
            busy={isOpeningFile}
            onOpenFile={
              onOpenFile
                ? (target) => {
                    onSelect(target)
                    onOpenFile(target)
                  }
                : undefined
            }
            onRequestTrashFile={onRequestTrashFile}
          />
        ) : null}
      </div>
    </div>
  )
}

function handleTreeItemClick(
  event: MouseEvent<Element>,
  node: RepoTreeNode,
  isExpanded: boolean,
  onRowClick: (node: RepoTreeNode, isExpanded: boolean) => void,
) {
  if (event.target instanceof Element && isFiletreeRowControl(event.target)) return
  onRowClick(node, isExpanded)
}

function isFiletreeRowControl(target: Element): boolean {
  return target.closest('[data-action-popover-trigger], button[slot="chevron"]') !== null
}

function handleItemDoubleClick(
  event: MouseEvent<HTMLElement>,
  node: RepoTreeNode,
  onOpenFile: (node: RepoTreeNode) => void,
): void {
  if (node.kind !== 'file') return
  if ((event.target as HTMLElement | null)?.closest('[data-action-popover-trigger]')) return
  onOpenFile(node)
}

function FiletreeActionMenu({
  node,
  busy,
  onOpenFile,
  onRequestTrashFile,
}: {
  readonly node: RepoTreeNode
  readonly busy: boolean
  readonly onOpenFile?: (node: RepoTreeNode) => void
  readonly onRequestTrashFile?: (node: RepoTreeNode) => void
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  // Compact UI has no hover affordance, so pin the trigger visible.
  // While the popover is open or the row is busy, keep the trigger visible
  // so progress stays anchored to the action the user just triggered.
  const alwaysVisible = useIsCompactUi() || open || busy

  return (
    <ActionPopover
      label={t(FILE_TREE_I18N_KEYS.actionMenu)}
      open={open}
      onOpenChange={setOpen}
      busy={busy}
      triggerClassName={cn(
        'ml-auto size-5 shrink-0 p-0 transition-opacity duration-100',
        alwaysVisible && 'opacity-100',
        !alwaysVisible && 'opacity-0 group-hover/filetree-row:opacity-100',
      )}
      contentClassName="min-w-32 max-w-56"
    >
      {({ close }) => (
        <div role="list">
          {onOpenFile ? (
            <div className="space-y-0.5 p-1" role="group">
              <div role="listitem">
                <ActionPopoverItem
                  label={t(FILE_TREE_I18N_KEYS.open)}
                  disabled={busy}
                  busy={busy}
                  onSelect={() => {
                    close()
                    onOpenFile(node)
                  }}
                />
              </div>
            </div>
          ) : null}
          {onRequestTrashFile ? (
            <div className="space-y-0.5 border-t border-border p-1" role="group">
              <div role="listitem">
                <ActionPopoverItem
                  label={t(FILE_TREE_I18N_KEYS.delete)}
                  icon={<Trash2 />}
                  destructive
                  onSelect={() => {
                    close()
                    onRequestTrashFile(node)
                  }}
                />
              </div>
            </div>
          ) : null}
        </div>
      )}
    </ActionPopover>
  )
}

function topVisibleRowIndexFromViewport(viewport: HTMLElement): number {
  return Math.max(0, Math.floor(viewport.scrollTop / FILETREE_ROW_HEIGHT))
}

// Render an empty body with no worktree via a dedicated helper so
// callers can compose the no-worktree case.
export function FiletreeNoWorktreeView(): ReactNode {
  const t = useT()
  return (
    <EmptyState
      icon={<FolderTree size={16} />}
      title={t(FILE_TREE_I18N_KEYS.noWorktreeTitle)}
      body={t(FILE_TREE_I18N_KEYS.noWorktreeBody)}
    />
  )
}
