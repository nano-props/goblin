// Read-only file tree view for the worktree-scoped file tree
// (docs/filetree.md).
//
// The component is pure: it consumes the hook output, manages
// expand/collapse state locally, and renders a flat list of nodes
// nested by parent/child via a useMemo-derived index. Selection is
// the only visible interaction in v1; the future onActivate handler
// is reserved as an optional prop.
//
// Keyboard navigation (F7) follows the WAI-ARIA tree pattern with
// roving tabindex: only the focused row has tabIndex=0; the rest
// are tabIndex=-1. ArrowDown / ArrowUp move focus between visible
// rows; ArrowRight expands a collapsed directory OR moves into the
// first child of an expanded one; ArrowLeft collapses an expanded
// directory OR moves to the parent; Enter / Space activates.
//
// Anti-coupling rules (enforced by review):
//   - No fetches, no server modules, no store mutations.
//   - No imports from useReposStore, terminal hooks, or settings.
//   - All copy comes from the i18n layer; keys are static.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronRight, File, Folder, FolderTree } from 'lucide-react'
import type { RepoTreeNode, RepoTreeNodeStatus, RepoTreeResult } from '#/shared/api-types.ts'
import { useT } from '#/web/stores/i18n.ts'
import { EmptyState } from '#/web/components/Layout.tsx'
import { focusRingInset } from '#/web/components/ui/focus.ts'
import { cn } from '#/web/lib/cn.ts'

export interface FiletreeViewProps {
  readonly tree: RepoTreeResult | null
  readonly loading: boolean
  readonly error: string | null
  readonly stale: boolean
  readonly onSelect?: (node: RepoTreeNode) => void
  readonly onActivate?: (node: RepoTreeNode) => void
}

const FILE_TREE_I18N_KEYS = {
  empty: 'filetree.empty',
  noWorktreeTitle: 'filetree.no-worktree-title',
  noWorktreeBody: 'filetree.no-worktree-body',
  truncated: 'filetree.truncated',
  error: 'filetree.error',
  statusModified: 'filetree.status.modified',
  statusStaged: 'filetree.status.staged',
  statusUntracked: 'filetree.status.untracked',
  statusIgnored: 'filetree.status.ignored',
} as const satisfies Record<string, string>

const STATUS_LABEL_KEYS: Record<Exclude<RepoTreeNodeStatus, 'clean'>, string> = {
  modified: FILE_TREE_I18N_KEYS.statusModified,
  staged: FILE_TREE_I18N_KEYS.statusStaged,
  untracked: FILE_TREE_I18N_KEYS.statusUntracked,
  ignored: FILE_TREE_I18N_KEYS.statusIgnored,
}

interface IndexedNode {
  readonly node: RepoTreeNode
  readonly depth: number
}

interface FiletreeIndex {
  readonly byId: ReadonlyMap<string, RepoTreeNode>
  readonly childrenByParent: ReadonlyMap<string | null, ReadonlyArray<RepoTreeNode>>
  readonly visible: () => ReadonlyArray<IndexedNode>
}

function buildIndex(result: RepoTreeResult | null): FiletreeIndex {
  const byId = new Map<string, RepoTreeNode>()
  const childrenByParent = new Map<string | null, RepoTreeNode[]>()
  if (!result) {
    return {
      byId,
      childrenByParent,
      visible: () => [],
    }
  }
  for (const node of result.nodes) byId.set(node.id, node)
  for (const node of result.nodes) {
    const list = childrenByParent.get(node.parentId) ?? []
    list.push(node)
    childrenByParent.set(node.parentId, list)
  }
  // Sort each child list: directories first, then alphabetical.
  for (const list of childrenByParent.values()) {
    list.sort(compareNodesForRender)
  }
  return {
    byId,
    childrenByParent,
    visible: () => flattenVisible(childrenByParent, byId),
  }
}

function compareNodesForRender(a: RepoTreeNode, b: RepoTreeNode): number {
  if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function flattenVisible(
  childrenByParent: ReadonlyMap<string | null, ReadonlyArray<RepoTreeNode>>,
  byId: ReadonlyMap<string, RepoTreeNode>,
): IndexedNode[] {
  const out: IndexedNode[] = []
  // Track ancestry to avoid pathological cycles; in normal data the
  // graph is acyclic, but a defensive check keeps a bug from freezing
  // the renderer.
  const seen = new Set<string>()
  const visit = (parentId: string | null, depth: number): void => {
    const children = childrenByParent.get(parentId)
    if (!children) return
    for (const child of children) {
      out.push({ node: child, depth })
      if (child.kind === 'directory') {
        if (seen.has(child.id)) continue
        seen.add(child.id)
        visit(child.id, depth + 1)
      }
    }
  }
  void byId
  visit(null, 0)
  return out
}

export function FiletreeView({
  tree,
  loading,
  error,
  stale,
  onSelect,
  onActivate,
}: FiletreeViewProps) {
  const t = useT()
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set<string>())
  // F7: focused row id, drives roving tabindex and ArrowUp/Down
  // navigation. Initialised lazily to the first visible row once a
  // tree is rendered.
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const containerRef = useRef<HTMLUListElement>(null)

  const index = useMemo(() => buildIndex(tree), [tree])

  const visible = useMemo<ReadonlyArray<IndexedNode>>(() => {
    if (loading && !tree) return []
    if (error) return []
    return index.visible().filter((entry) => {
      if (entry.depth === 0) return true
      let cursor = entry.node.parentId
      while (cursor !== null) {
        if (!expanded.has(cursor)) return false
        const parent = index.byId.get(cursor)
        if (!parent) return false
        if (parent.parentId === cursor) return false // defensive: cycle guard
        cursor = parent.parentId
      }
      return true
    })
  }, [index, expanded, loading, error, tree])

  const visibleIds = useMemo<ReadonlyArray<string>>(
    () => visible.map((entry) => entry.node.id),
    [visible],
  )

  // Reset focus when the tree prop changes (new snapshot, no carry
  // over from the previous worktree). Pick the first visible row so
  // the user lands somewhere sensible when the keyboard lands them
  // back in the panel.
  useEffect(() => {
    setFocusedId(visibleIds[0] ?? null)
  }, [tree, visibleIds])

  // If the focused row is no longer visible (its parent collapsed,
  // or the tree dropped it), drop focus to the first visible row.
  useEffect(() => {
    if (focusedId === null) return
    if (!visibleIds.includes(focusedId)) {
      setFocusedId(visibleIds[0] ?? null)
    }
  }, [focusedId, visibleIds])

  // Move the DOM focus to whichever row now owns the roving tabindex.
  // We only act when the tree itself reports `document.activeElement`
  // inside the tree (i.e. keyboard focus is already in this widget),
  // so a stray state update doesn't yank focus away from the user's
  // click target elsewhere on the page.
  useEffect(() => {
    if (!focusedId) return
    const container = containerRef.current
    if (!container) return
    const active = document.activeElement
    if (active && container.contains(active)) {
      const next = container.querySelector<HTMLElement>(`[data-filetree-row="${CSS.escape(focusedId)}"]`)
      if (next && active !== next) next.focus()
    }
  }, [focusedId, visibleIds])

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const moveFocusBy = useCallback(
    (delta: number) => {
      setFocusedId((current) => {
        if (visibleIds.length === 0) return null
        const start = current ? visibleIds.indexOf(current) : -1
        if (start < 0) return visibleIds[0] ?? null
        const next = Math.max(0, Math.min(visibleIds.length - 1, start + delta))
        return visibleIds[next] ?? null
      })
    },
    [visibleIds],
  )

  const focusParent = useCallback(() => {
    if (!focusedId) return
    const node = index.byId.get(focusedId)
    if (!node || node.parentId === null) return
    // If the parent is collapsed, expand it so the user lands on a
    // visible ancestor. The first moveFocusBy(-1) lands on the
    // previous visible row, which is the parent's previous sibling;
    // explicitly target the parent for predictability.
    setFocusedId(node.parentId)
  }, [focusedId, index])

  const focusFirstChild = useCallback(() => {
    if (!focusedId) return
    const children = index.childrenByParent.get(focusedId)
    if (!children || children.length === 0) return
    const first = children[0]
    if (first) setFocusedId(first.id)
  }, [focusedId, index])

  const handleRowKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>, row: FiletreeRowKeyContext) => {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault()
          moveFocusBy(1)
          return
        case 'ArrowUp':
          event.preventDefault()
          moveFocusBy(-1)
          return
        case 'Home':
          event.preventDefault()
          setFocusedId(visibleIds[0] ?? null)
          return
        case 'End':
          event.preventDefault()
          setFocusedId(visibleIds[visibleIds.length - 1] ?? null)
          return
        case 'ArrowRight':
          if (row.isDirectory) {
            event.preventDefault()
            if (row.expanded) {
              focusFirstChild()
            } else {
              toggle(row.id)
            }
          }
          return
        case 'ArrowLeft':
          if (row.isDirectory && row.expanded) {
            event.preventDefault()
            toggle(row.id)
          } else {
            event.preventDefault()
            focusParent()
          }
          return
        case 'Enter':
        case ' ':
          event.preventDefault()
          if (row.isDirectory) toggle(row.id)
          onActivate?.(row.node)
          return
        default:
          return
      }
    },
    [focusFirstChild, focusParent, moveFocusBy, onActivate, toggle, visibleIds],
  )

  if (error) {
    return <EmptyState icon={<FolderTree size={16} />} title={t(FILE_TREE_I18N_KEYS.error)} />
  }

  if (loading && !tree) {
    return <EmptyState icon={<FolderTree size={16} />} title={t(FILE_TREE_I18N_KEYS.empty)} />
  }

  if (tree && tree.nodes.length === 0) {
    return <EmptyState icon={<FolderTree size={16} />} title={t(FILE_TREE_I18N_KEYS.empty)} />
  }

  return (
    <div
      data-filetree=""
      aria-busy={loading || undefined}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div
        className="min-h-0 flex-1 overflow-auto border-l border-border pl-3"
        role="tree"
        aria-label="File tree"
      >
        <ul ref={containerRef} className="py-1.5 font-mono text-sm">
          {visible.map((entry) => (
            <FiletreeRow
              key={entry.node.id}
              entry={entry}
              expanded={expanded.has(entry.node.id)}
              focused={entry.node.id === focusedId}
              onToggle={toggle}
              onSelect={onSelect}
              onActivate={onActivate}
              onKeyDown={handleRowKeyDown}
              onFocusRow={setFocusedId}
            />
          ))}
        </ul>
      </div>
      {stale ? (
        <div className="border-t border-warning-border bg-warning-surface px-4 py-1 text-xs text-warning">
          {t('status.stale-title')}
        </div>
      ) : null}
      {tree?.truncated ? (
        <div className="border-t border-border bg-muted px-4 py-1 text-xs text-muted-foreground">
          {t(FILE_TREE_I18N_KEYS.truncated)}
        </div>
      ) : null}
    </div>
  )
}

interface FiletreeRowKeyContext {
  readonly id: string
  readonly node: RepoTreeNode
  readonly isDirectory: boolean
  readonly expanded: boolean
}

interface FiletreeRowProps {
  readonly entry: IndexedNode
  readonly expanded: boolean
  readonly focused: boolean
  readonly onToggle: (id: string) => void
  readonly onSelect?: (node: RepoTreeNode) => void
  readonly onActivate?: (node: RepoTreeNode) => void
  readonly onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>, ctx: FiletreeRowKeyContext) => void
  readonly onFocusRow: (id: string) => void
}

function FiletreeRow({
  entry,
  expanded,
  focused,
  onToggle,
  onSelect,
  onActivate,
  onKeyDown,
  onFocusRow,
}: FiletreeRowProps) {
  const { node, depth } = entry
  const isDirectory = node.kind === 'directory'

  const handleClick = () => {
    if (isDirectory) onToggle(node.id)
    onSelect?.(node)
  }

  return (
    <li role="treeitem" aria-expanded={isDirectory ? expanded : undefined} aria-level={depth + 1}>
      <div
        role="button"
        tabIndex={focused ? 0 : -1}
        data-filetree-row={node.id}
        aria-label={node.name}
        aria-selected={focused || undefined}
        onClick={handleClick}
        onFocus={() => onFocusRow(node.id)}
        onKeyDown={(event) => onKeyDown(event, { id: node.id, node, isDirectory, expanded })}
        className={cn(
          'flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted',
          focusRingInset,
        )}
        style={{ paddingLeft: `${depth * 12 + 6}px` }}
      >
        <span className="flex w-3 shrink-0 items-center justify-center text-muted-foreground">
          {isDirectory ? (
            <ChevronRight
              size={12}
              aria-hidden
              className={cn('transition-transform', expanded ? 'rotate-90' : 'rotate-0')}
            />
          ) : null}
        </span>
        <span className="flex w-3.5 shrink-0 items-center justify-center text-muted-foreground">
          {isDirectory ? <Folder size={12} aria-hidden /> : <File size={12} aria-hidden />}
        </span>
        <StatusDot status={node.status} />
        <span className="truncate text-foreground">{node.name}</span>
      </div>
    </li>
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

// Render an empty body with no worktree via a dedicated
// helper so callers can compose the no-worktree case.
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
