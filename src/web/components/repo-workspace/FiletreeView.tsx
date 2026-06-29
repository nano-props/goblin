// Read-only file tree view for the worktree-scoped file tree
// (docs/filetree.md).
//
// This component is deliberately thin: it maps the server's flat
// RepoTreeResult into a nested collection and delegates tree semantics
// (keyboard navigation, typeahead, roving focus, expansion and
// selection) to React Aria Components.

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode, type UIEvent } from 'react'
import {
  Button as AriaButton,
  Tree,
  TreeItem,
  TreeItemContent,
  type Key,
  type Selection,
  type TreeItemProps,
} from 'react-aria-components'
import { ChevronRight, File, Folder, FolderTree, Trash2 } from 'lucide-react'
import type { RepoTreeNode, RepoTreeResult } from '#/shared/api-types.ts'
import { useT } from '#/web/stores/i18n.ts'
import { EmptyState } from '#/web/components/Layout.tsx'
import { ActionPopover, ActionPopoverItem } from '#/web/components/ActionPopover.tsx'
import { focusRingInset } from '#/web/components/ui/focus.ts'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { useRestoreTopVisibleRowIndex } from '#/web/hooks/useRestoreTopVisibleRowIndex.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { cn } from '#/web/lib/cn.ts'

export interface FiletreeViewProps {
  readonly tree: RepoTreeResult | null
  readonly loading: boolean
  readonly error: string | null
  readonly onSelect?: (node: RepoTreeNode) => void
  readonly onActivate?: (node: RepoTreeNode) => void
  readonly onOpenFile?: (node: RepoTreeNode) => void
  readonly onRequestTrashFile?: (node: RepoTreeNode) => void
  readonly selectedKeys: ReadonlySet<Key>
  readonly expandedKeys: ReadonlySet<Key>
  readonly onSelectedKeysChange: (keys: Set<Key>) => void
  readonly onExpandedKeysChange: (keys: Set<Key>) => void
  readonly onDirectoryRowToggle: (key: string, expanded: boolean) => void
  readonly onPruneKeys: (validKeys: ReadonlySet<string>) => void
  readonly initialTopVisibleRowIndex: number
  readonly scrollRestoreKey: string
  readonly onTopVisibleRowIndexChange: (topVisibleRowIndex: number) => void
}

// `status` is part of the wire shape (`RepoTreeNodeStatus`) but v1's
// source layer hardcodes every node to `'clean'` (docs/filetree.md).
// We still consume the full union so the wire schema can grow a real
// `git status --porcelain` overlay later without a breaking type
// change, but the view does not render non-clean states today.
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

interface FiletreeItem {
  readonly id: string
  readonly node: RepoTreeNode
  readonly children: ReadonlyArray<FiletreeItem>
}

interface FiletreeCollection {
  readonly items: ReadonlyArray<FiletreeItem>
  readonly byId: ReadonlyMap<string, FiletreeItem>
}

type TreeItemPressEvent = Parameters<NonNullable<TreeItemProps['onPress']>>[0]

function buildCollection(result: RepoTreeResult | null): FiletreeCollection {
  const byId = new Map<string, FiletreeItem>()
  const childrenByParent = new Map<string | null, RepoTreeNode[]>()
  if (!result) return { items: [], byId }

  for (const node of result.nodes) {
    const list = childrenByParent.get(node.parentId) ?? []
    list.push(node)
    childrenByParent.set(node.parentId, list)
  }
  for (const list of childrenByParent.values()) list.sort(compareNodesForRender)

  const building = new Set<string>()
  const buildItem = (node: RepoTreeNode): FiletreeItem => {
    const existing = byId.get(node.id)
    if (existing) return existing

    building.add(node.id)
    const childNodes = node.kind === 'directory' ? (childrenByParent.get(node.id) ?? []) : []
    const children = childNodes.filter((child) => !building.has(child.id)).map((child) => buildItem(child))
    building.delete(node.id)

    const item: FiletreeItem = { id: node.id, node, children }
    byId.set(node.id, item)
    return item
  }

  const roots = (childrenByParent.get(null) ?? []).map((node) => buildItem(node))
  return { items: roots, byId }
}

function compareNodesForRender(a: RepoTreeNode, b: RepoTreeNode): number {
  if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
}

export function FiletreeView({
  tree,
  loading,
  error,
  onSelect,
  onActivate,
  onOpenFile,
  onRequestTrashFile,
  selectedKeys,
  expandedKeys,
  onSelectedKeysChange,
  onExpandedKeysChange,
  onDirectoryRowToggle,
  onPruneKeys,
  initialTopVisibleRowIndex,
  scrollRestoreKey,
  onTopVisibleRowIndexChange,
}: FiletreeViewProps) {
  const t = useT()
  const collection = useMemo(() => buildCollection(tree), [tree])
  const scrollViewportRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!tree) return
    onPruneKeys(new Set(collection.byId.keys()))
  }, [collection, onPruneKeys, tree])

  const handleSelectionChange = useCallback(
    (selection: Selection) => {
      const next = selection === 'all' ? new Set<Key>() : new Set(selection)
      onSelectedKeysChange(next)
      const first = next.values().next().value
      if (typeof first !== 'string') return
      const item = collection.byId.get(first)
      if (item) onSelect?.(item.node)
    },
    [collection, onSelect, onSelectedKeysChange],
  )

  const handleExpandedChange = useCallback(
    (keys: Set<Key>) => {
      onExpandedKeysChange(keys)
    },
    [onExpandedKeysChange],
  )

  useRestoreTopVisibleRowIndex({
    viewportRef: scrollViewportRef,
    restoreKey: scrollRestoreKey,
    topVisibleRowIndex: initialTopVisibleRowIndex,
    enabled: tree !== null,
    retrySignal: expandedKeys,
  })

  const handleRowPress = useCallback(
    (node: RepoTreeNode, isExpanded: boolean) => {
      onSelectedKeysChange(new Set<Key>([node.id]))
      if (node.kind !== 'directory') return
      onDirectoryRowToggle(node.id, !isExpanded)
    },
    [onDirectoryRowToggle, onSelectedKeysChange],
  )

  const handleOpenFile = useCallback(
    (node: RepoTreeNode) => {
      if (node.kind !== 'file') return
      onOpenFile?.(node)
      onActivate?.(node)
    },
    [onActivate, onOpenFile],
  )

  const handleKeyboardPressItem = useCallback(
    (node: RepoTreeNode, event: TreeItemPressEvent) => {
      if (event.pointerType !== 'keyboard') return
      handleOpenFile(node)
    },
    [handleOpenFile],
  )

  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      onTopVisibleRowIndexChange(topVisibleRowIndexFromViewport(event.currentTarget))
    },
    [onTopVisibleRowIndexChange],
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

  if (tree.nodes.length === 0) {
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
        viewportRef={scrollViewportRef}
        viewportClassName={focusRingInset}
        viewportOnScroll={handleScroll}
      >
        <Tree
          aria-label={t(FILE_TREE_I18N_KEYS.ariaLabel)}
          items={collection.items}
          dependencies={[collection]}
          selectionMode="single"
          selectionBehavior="replace"
          selectedKeys={selectedKeys}
          onSelectionChange={handleSelectionChange}
          expandedKeys={expandedKeys}
          onExpandedChange={handleExpandedChange}
          className="min-h-full font-sans text-sm"
        >
          {(item) => (
            <FiletreeTreeItem
              item={item}
              onKeyboardPressItem={handleKeyboardPressItem}
              onRowClick={handleRowPress}
              onOpenFile={handleOpenFile}
              onRequestTrashFile={onRequestTrashFile}
            />
          )}
        </Tree>
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

function FiletreeTreeItem({
  item,
  onKeyboardPressItem,
  onRowClick,
  onOpenFile,
  onRequestTrashFile,
}: {
  readonly item: FiletreeItem
  readonly onKeyboardPressItem: (node: RepoTreeNode, event: TreeItemPressEvent) => void
  readonly onRowClick: (node: RepoTreeNode, isExpanded: boolean) => void
  readonly onOpenFile: (node: RepoTreeNode) => void
  readonly onRequestTrashFile?: (node: RepoTreeNode) => void
}) {
  const { node, children } = item
  const isDirectory = node.kind === 'directory'

  return (
    <TreeItem
      id={node.id}
      textValue={node.name}
      aria-label={node.name}
      hasChildItems={isDirectory}
      onPress={(event) => onKeyboardPressItem(node, event)}
      onClick={(event) => handleTreeItemClick(event, node, onRowClick)}
      onDoubleClick={(event) => handleItemDoubleClick(event, node, onOpenFile)}
      className={({ isSelected, isFocused, isFocusVisible, isHovered, isPressed }) =>
        cn(
          'group/filetree-row cursor-pointer text-foreground outline-none transition-colors duration-100',
          (isHovered || isFocused || isPressed) && !isSelected && 'bg-muted',
          isSelected && 'bg-selected text-selected-foreground',
          isFocusVisible && focusRingInset,
        )
      }
    >
      <TreeItemContent>
        {({ isExpanded, level, hasChildItems }) => (
          <div
            data-filetree-row=""
            className="flex w-full min-w-0 items-center gap-1 px-1.5 py-0.5"
            style={{ paddingLeft: `${(level - 1) * 12 + 6}px` }}
          >
            <span className="flex w-3 shrink-0 items-center justify-center text-muted-foreground">
              {hasChildItems ? (
                <AriaButton slot="chevron" className="flex size-3 items-center justify-center rounded-sm outline-none">
                  <ChevronRight
                    size={12}
                    aria-hidden
                    className={cn('transition-transform', isExpanded ? 'rotate-90' : 'rotate-0')}
                  />
                </AriaButton>
              ) : null}
            </span>
            <span className="flex w-3.5 shrink-0 items-center justify-center text-muted-foreground">
              {isDirectory ? <Folder size={12} aria-hidden /> : <File size={12} aria-hidden />}
            </span>
            <span className="min-w-0 flex-1 truncate text-current">{node.name}</span>
            {!isDirectory ? (
              <FiletreeActionMenu node={node} onOpenFile={onOpenFile} onRequestTrashFile={onRequestTrashFile} />
            ) : null}
          </div>
        )}
      </TreeItemContent>
      {children.map((child) => (
        <FiletreeTreeItem
          key={child.id}
          item={child}
          onKeyboardPressItem={onKeyboardPressItem}
          onRowClick={onRowClick}
          onOpenFile={onOpenFile}
          onRequestTrashFile={onRequestTrashFile}
        />
      ))}
    </TreeItem>
  )
}

function handleTreeItemClick(
  event: MouseEvent<Element>,
  node: RepoTreeNode,
  onRowClick: (node: RepoTreeNode, isExpanded: boolean) => void,
) {
  if (!isCurrentTreeRowClick(event)) return
  if (event.target instanceof Element && isFiletreeRowControl(event.target)) return
  onRowClick(node, event.currentTarget.getAttribute('aria-expanded') === 'true')
}

function isCurrentTreeRowClick(event: MouseEvent<Element>): boolean {
  return event.target instanceof Element && event.target.closest('[role="row"]') === event.currentTarget
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
  onOpenFile,
  onRequestTrashFile,
}: {
  readonly node: RepoTreeNode
  readonly onOpenFile: (node: RepoTreeNode) => void
  readonly onRequestTrashFile?: (node: RepoTreeNode) => void
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  // Compact UI has no hover affordance, so pin the trigger visible.
  // While the popover is open, keep the trigger visible above it.
  const alwaysVisible = useIsCompactUi() || open

  return (
    <ActionPopover
      label={t(FILE_TREE_I18N_KEYS.actionMenu)}
      open={open}
      onOpenChange={setOpen}
      triggerClassName={cn(
        'ml-auto size-5 shrink-0 p-0 transition-opacity duration-100',
        alwaysVisible && 'opacity-100',
        !alwaysVisible && 'opacity-0 group-hover/filetree-row:opacity-100',
      )}
      contentClassName="min-w-32 max-w-56"
    >
      {({ close }) => (
        <div role="list">
          <div className="space-y-0.5 p-1" role="group">
            <div role="listitem">
              <ActionPopoverItem
                label={t(FILE_TREE_I18N_KEYS.open)}
                onSelect={() => {
                  close()
                  onOpenFile(node)
                }}
              />
            </div>
          </div>
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
  const row = viewport.querySelector<HTMLElement>('[data-filetree-row]')
  const rowHeight = row?.offsetHeight ?? 0
  if (rowHeight <= 0) return 0
  return Math.max(0, Math.floor(viewport.scrollTop / rowHeight))
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
