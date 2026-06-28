// Read-only file tree view for the worktree-scoped file tree
// (docs/filetree.md).
//
// This component is deliberately thin: it maps the server's flat
// RepoTreeResult into a nested collection and delegates tree semantics
// (keyboard navigation, typeahead, roving focus, expansion and
// selection) to React Aria Components.

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react'
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
import type { RepoTreeNode, RepoTreeNodeStatus, RepoTreeResult } from '#/shared/api-types.ts'
import { useT } from '#/web/stores/i18n.ts'
import { EmptyState } from '#/web/components/Layout.tsx'
import { ActionPopover, ActionPopoverItem } from '#/web/components/ActionPopover.tsx'
import { focusRingInset } from '#/web/components/ui/focus.ts'
import { cn } from '#/web/lib/cn.ts'

export interface FiletreeViewProps {
  readonly tree: RepoTreeResult | null
  readonly loading: boolean
  readonly error: string | null
  readonly onSelect?: (node: RepoTreeNode) => void
  readonly onActivate?: (node: RepoTreeNode) => void
  readonly onOpenFile?: (node: RepoTreeNode) => void
  readonly onRequestTrashFile?: (node: RepoTreeNode) => void
}

const FILE_TREE_I18N_KEYS = {
  ariaLabel: 'filetree.aria-label',
  empty: 'filetree.empty',
  loading: 'filetree.loading',
  noWorktreeTitle: 'filetree.no-worktree-title',
  noWorktreeBody: 'filetree.no-worktree-body',
  truncated: 'filetree.truncated',
  error: 'filetree.error',
  statusModified: 'filetree.status.modified',
  statusStaged: 'filetree.status.staged',
  statusUntracked: 'filetree.status.untracked',
  statusIgnored: 'filetree.status.ignored',
  open: 'app-chrome.open',
  delete: 'menu.edit.delete',
  actionMenu: 'action.menu',
} as const satisfies Record<string, string>

const STATUS_LABEL_KEYS: Record<Exclude<RepoTreeNodeStatus, 'clean'>, string> = {
  modified: FILE_TREE_I18N_KEYS.statusModified,
  staged: FILE_TREE_I18N_KEYS.statusStaged,
  untracked: FILE_TREE_I18N_KEYS.statusUntracked,
  ignored: FILE_TREE_I18N_KEYS.statusIgnored,
}

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

interface FiletreeInteractionState {
  readonly selectedKeys: Set<Key>
  readonly expandedKeys: Set<Key>
}

type FiletreeInteractionAction =
  | { readonly type: 'reset' }
  | { readonly type: 'set-selected-keys'; readonly keys: Set<Key> }
  | { readonly type: 'set-expanded-keys'; readonly keys: Set<Key> }
  | { readonly type: 'press-row'; readonly node: RepoTreeNode }

function initialFiletreeInteractionState(): FiletreeInteractionState {
  return {
    selectedKeys: new Set(),
    expandedKeys: new Set(),
  }
}

function filetreeInteractionReducer(
  state: FiletreeInteractionState,
  action: FiletreeInteractionAction,
): FiletreeInteractionState {
  switch (action.type) {
    case 'reset':
      return initialFiletreeInteractionState()
    case 'set-selected-keys':
      return { ...state, selectedKeys: action.keys }
    case 'set-expanded-keys':
      return { ...state, expandedKeys: action.keys }
    case 'press-row': {
      const selectedKeys = new Set<Key>([action.node.id])
      if (action.node.kind !== 'directory') return { ...state, selectedKeys }

      const expandedKeys = new Set(state.expandedKeys)
      if (expandedKeys.has(action.node.id)) expandedKeys.delete(action.node.id)
      else expandedKeys.add(action.node.id)
      return { selectedKeys, expandedKeys }
    }
  }
}

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
}: FiletreeViewProps) {
  const t = useT()
  const collection = useMemo(() => buildCollection(tree), [tree])
  const [interaction, dispatchInteraction] = useReducer(
    filetreeInteractionReducer,
    undefined,
    initialFiletreeInteractionState,
  )

  useEffect(() => {
    dispatchInteraction({ type: 'reset' })
  }, [tree])

  const handleSelectionChange = useCallback(
    (selection: Selection) => {
      const next = selection === 'all' ? new Set<Key>() : new Set(selection)
      dispatchInteraction({ type: 'set-selected-keys', keys: next })
      const first = next.values().next().value
      if (typeof first !== 'string') return
      const item = collection.byId.get(first)
      if (item) onSelect?.(item.node)
    },
    [collection, onSelect],
  )

  const handleExpandedChange = useCallback((keys: Set<Key>) => {
    dispatchInteraction({ type: 'set-expanded-keys', keys })
  }, [])

  const handleRowPress = useCallback(
    (node: RepoTreeNode) => {
      dispatchInteraction({ type: 'press-row', node })
    },
    [],
  )

  const handleOpenFile = useCallback(
    (node: RepoTreeNode) => {
      if (node.kind !== 'file') return
      onOpenFile?.(node)
      onActivate?.(node)
    },
    [onActivate, onOpenFile],
  )

  const handlePressItem = useCallback(
    (node: RepoTreeNode, event: TreeItemPressEvent) => {
      if (event.target.closest('[data-action-popover-trigger]')) return
      const pressedChevron = event.target.closest('button[slot="chevron"]') !== null
      if (pressedChevron) return
      if (event.pointerType === 'keyboard') {
        handleOpenFile(node)
        return
      }
      handleRowPress(node)
    },
    [handleOpenFile, handleRowPress],
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
      <Tree
        aria-label={t(FILE_TREE_I18N_KEYS.ariaLabel)}
        items={collection.items}
        dependencies={[collection]}
        selectionMode="single"
        selectionBehavior="replace"
        selectedKeys={interaction.selectedKeys}
        onSelectionChange={handleSelectionChange}
        expandedKeys={interaction.expandedKeys}
        onExpandedChange={handleExpandedChange}
        className={cn('min-h-0 flex-1 overflow-auto py-1.5 font-sans text-sm', focusRingInset)}
      >
        {(item) => (
          <FiletreeTreeItem
            item={item}
            onPressItem={handlePressItem}
            onOpenFile={handleOpenFile}
            onRequestTrashFile={onRequestTrashFile}
          />
        )}
      </Tree>
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
  onPressItem,
  onOpenFile,
  onRequestTrashFile,
}: {
  readonly item: FiletreeItem
  readonly onPressItem: (node: RepoTreeNode, event: TreeItemPressEvent) => void
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
      onPress={(event) => onPressItem(node, event)}
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
            <StatusDot status={node.status} />
            <span className="min-w-0 flex-1 truncate text-current">{node.name}</span>
            {!isDirectory ? (
              <FiletreeActionMenu
                node={node}
                onOpenFile={onOpenFile}
                onRequestTrashFile={onRequestTrashFile}
              />
            ) : null}
          </div>
        )}
      </TreeItemContent>
      {children.map((child) => (
        <FiletreeTreeItem
          key={child.id}
          item={child}
          onPressItem={onPressItem}
          onOpenFile={onOpenFile}
          onRequestTrashFile={onRequestTrashFile}
        />
      ))}
    </TreeItem>
  )
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

  return (
    <ActionPopover
      label={t(FILE_TREE_I18N_KEYS.actionMenu)}
      open={open}
      onOpenChange={setOpen}
      triggerClassName={cn(
        'ml-auto size-5 shrink-0 p-0 opacity-0 transition-opacity duration-100',
        'group-hover/filetree-row:opacity-100',
        open && 'opacity-100',
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

function StatusDot({ status }: { status: RepoTreeNodeStatus }) {
  if (status === 'clean') return <span className="w-1.5 shrink-0" aria-hidden />
  const t = useT()
  const color =
    status === 'modified' || status === 'untracked'
      ? 'var(--color-warning)'
      : status === 'staged'
        ? 'var(--color-success)'
        : 'var(--color-muted-foreground)'
  return (
    <span
      className="h-1.5 w-1.5 shrink-0 rounded-full"
      style={{ background: color }}
      aria-label={t(STATUS_LABEL_KEYS[status])}
    />
  )
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
