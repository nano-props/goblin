// Read-only file tree view for a filesystem-scoped Workspace Pane target
// (docs/filetree.md).

import { useCallback, useEffect, useMemo, useRef, type KeyboardEvent, type ReactNode, type UIEvent } from 'react'
import type { Key } from 'react-aria-components'
import { useVirtualizer } from '@tanstack/react-virtual'
import { FolderTree, RefreshCw } from 'lucide-react'
import type { WorkspaceFilesystemNode } from '#/shared/api-types.ts'
import type { LazyWorkspaceFilesystemTreeAggregate } from '#/web/workspace-filesystem-lazy-state.ts'
import { useT } from '#/web/stores/i18n.ts'
import { EmptyState } from '#/web/components/Layout.tsx'
import { focusRingInset } from '#/web/components/ui/focus.ts'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { Button } from '#/web/components/ui/button.tsx'
import { buildFiletreeCollection } from '#/web/components/workspace-pane/filetree-collection.ts'
import { FiletreeTreeRow } from '#/web/components/workspace-pane/FiletreeTreeRow.tsx'
import {
  FILETREE_ROW_HEIGHT,
  findTypeaheadRowIndex,
  firstStringKey,
  focusFiletreeRowAtIndex,
  topVisibleFiletreeRowIndex,
} from '#/web/components/workspace-pane/filetree-navigation.ts'
import { useRestoreTopVisibleRowIndex } from '#/web/hooks/useRestoreTopVisibleRowIndex.ts'

export interface FiletreeViewProps {
  readonly tree: LazyWorkspaceFilesystemTreeAggregate | null
  readonly isInitialLoading: boolean
  readonly isReading: boolean
  readonly loadingKeys?: ReadonlySet<string>
  readonly openingFileKeys?: ReadonlySet<string>
  readonly error: string | null
  readonly onSelect?: (node: WorkspaceFilesystemNode) => void
  readonly onActivate?: (node: WorkspaceFilesystemNode) => void
  readonly onOpenFile?: (node: WorkspaceFilesystemNode) => void
  readonly onRequestTrashFile?: (node: WorkspaceFilesystemNode) => void
  readonly selectedKeys: ReadonlySet<Key>
  readonly expandedKeys: ReadonlySet<Key>
  readonly onSelectedKeysChange: (keys: Set<Key>) => void
  readonly onDirectoryRowToggle: (key: string, expanded: boolean) => void
  readonly onPruneKeys: (validKeys: ReadonlySet<string>) => void
  readonly onRetry?: () => void
  readonly initialTopVisibleRowIndex: number
  readonly scrollRestoreKey: string
  readonly scrollRestoreReady: boolean
  readonly onTopVisibleRowIndexChange: (topVisibleRowIndex: number) => void
}

const FILE_TREE_I18N_KEYS = {
  ariaLabel: 'filetree.aria-label',
  empty: 'filetree.empty',
  truncated: 'filetree.truncated',
  error: 'filetree.error',
  stale: 'filetree.stale-title',
} as const satisfies Record<string, string>

export function FiletreeView({
  tree,
  isInitialLoading,
  isReading,
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
  onRetry,
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
    (node: WorkspaceFilesystemNode) => {
      onSelectedKeysChange(new Set<Key>([node.id]))
      onSelect?.(node)
    },
    [onSelect, onSelectedKeysChange],
  )

  const handleRowPress = useCallback(
    (node: WorkspaceFilesystemNode, isExpanded: boolean) => {
      selectNode(node)
      if (node.kind !== 'directory') return
      onDirectoryRowToggle(node.id, !isExpanded)
    },
    [onDirectoryRowToggle, selectNode],
  )

  const handleOpenFile = useCallback(
    (node: WorkspaceFilesystemNode) => {
      if (node.kind !== 'file') return
      onOpenFile?.(node)
      onActivate?.(node)
    },
    [onActivate, onOpenFile],
  )

  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      onTopVisibleRowIndexChange(topVisibleFiletreeRowIndex(event.currentTarget))
    },
    [onTopVisibleRowIndexChange],
  )

  const handleRowKeyDown = useCallback(
    (node: WorkspaceFilesystemNode, event: KeyboardEvent<HTMLDivElement>) => {
      const rowIndex = collection.rows.findIndex((row) => row.id === node.id)
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        focusFiletreeRowAtIndex(
          scrollViewportRef.current,
          rowVirtualizer,
          Math.min(collection.rows.length - 1, rowIndex + 1),
        )
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        focusFiletreeRowAtIndex(scrollViewportRef.current, rowVirtualizer, Math.max(0, rowIndex - 1))
        return
      }
      if (event.key === 'Home') {
        event.preventDefault()
        focusFiletreeRowAtIndex(scrollViewportRef.current, rowVirtualizer, 0)
        return
      }
      if (event.key === 'End') {
        event.preventDefault()
        focusFiletreeRowAtIndex(scrollViewportRef.current, rowVirtualizer, collection.rows.length - 1)
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
          focusFiletreeRowAtIndex(scrollViewportRef.current, rowVirtualizer, matchIndex)
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

  if (error && !tree) {
    return (
      <FiletreeShell loading={isReading}>
        <EmptyState
          icon={<FolderTree size={16} />}
          title={t(FILE_TREE_I18N_KEYS.error)}
          body={
            onRetry ? (
              <Button type="button" variant="default" disabled={isReading} onClick={onRetry}>
                <RefreshCw className={isReading ? 'animate-spin' : undefined} />
                {t('error.try-again')}
              </Button>
            ) : undefined
          }
        />
      </FiletreeShell>
    )
  }

  if (!tree) {
    if (isInitialLoading) {
      return <FiletreeShell loading={isInitialLoading} />
    }
    return (
      <FiletreeShell loading={isInitialLoading}>
        <EmptyState icon={<FolderTree size={16} />} title={t(FILE_TREE_I18N_KEYS.empty)} />
      </FiletreeShell>
    )
  }

  if (collection.rows.length === 0) {
    return (
      <FiletreeShell loading={isReading}>
        {error ? <FiletreeStaleNotice isReading={isReading} onRetry={onRetry} /> : null}
        <EmptyState icon={<FolderTree size={16} />} title={t(FILE_TREE_I18N_KEYS.empty)} />
      </FiletreeShell>
    )
  }

  return (
    <FiletreeShell loading={isReading}>
      {error ? <FiletreeStaleNotice isReading={isReading} onRetry={onRetry} /> : null}
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

function FiletreeStaleNotice({ isReading, onRetry }: { isReading: boolean; onRetry?: () => void }) {
  const t = useT()
  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 border-b border-warning-border bg-warning-surface px-4 py-2 text-xs text-warning"
    >
      <span className="font-medium">{t(FILE_TREE_I18N_KEYS.stale)}</span>
      {onRetry ? (
        <Button type="button" size="sm" variant="ghost" disabled={isReading} onClick={onRetry}>
          <RefreshCw className={isReading ? 'animate-spin' : undefined} />
          {t('error.try-again')}
        </Button>
      ) : null}
    </div>
  )
}

function FiletreeShell({ loading, children }: { readonly loading: boolean; readonly children?: ReactNode }) {
  return (
    <div data-filetree="" aria-busy={loading || undefined} className="flex min-h-0 flex-1 flex-col">
      {children}
    </div>
  )
}
