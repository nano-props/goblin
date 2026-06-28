// Read-only file tree view for the worktree-scoped file tree
// (docs/filetree.md).
//
// The component is pure: it consumes the hook output, manages
// expand/collapse state locally, and renders a flat list of nodes
// nested by parent/child via a useMemo-derived index. Selection is
// the only visible interaction in v1; the future onActivate handler
// is reserved as an optional prop.
//
// Anti-coupling rules (enforced by review):
//   - No fetches, no server modules, no store mutations.
//   - No imports from useReposStore, terminal hooks, or settings.
//   - All copy comes from the i18n layer; keys are static.

import { useCallback, useMemo, useState, type ReactNode } from 'react'
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
} as const satisfies Record<string, string>

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

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

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
        <ul className="py-1.5 font-mono text-sm">
          {visible.map((entry) => (
            <FiletreeRow
              key={entry.node.id}
              entry={entry}
              expanded={expanded.has(entry.node.id)}
              onToggle={toggle}
              onSelect={onSelect}
              onActivate={onActivate}
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

interface FiletreeRowProps {
  readonly entry: IndexedNode
  readonly expanded: boolean
  readonly onToggle: (id: string) => void
  readonly onSelect?: (node: RepoTreeNode) => void
  readonly onActivate?: (node: RepoTreeNode) => void
}

function FiletreeRow({ entry, expanded, onToggle, onSelect, onActivate }: FiletreeRowProps) {
  const { node, depth } = entry
  const isDirectory = node.kind === 'directory'

  const handleClick = () => {
    if (isDirectory) onToggle(node.id)
    onSelect?.(node)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (isDirectory) onToggle(node.id)
      onActivate?.(node)
    } else if (isDirectory && event.key === 'ArrowRight' && !expanded) {
      event.preventDefault()
      onToggle(node.id)
    } else if (isDirectory && event.key === 'ArrowLeft' && expanded) {
      event.preventDefault()
      onToggle(node.id)
    }
  }

  return (
    <li role="treeitem" aria-expanded={isDirectory ? expanded : undefined} aria-level={depth + 1}>
      <div
        role="button"
        tabIndex={0}
        aria-label={node.name}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
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
  const color =
    status === 'modified' || status === 'untracked'
      ? 'var(--color-warning)'
      : status === 'staged'
        ? 'var(--color-success)'
        : status === 'ignored'
          ? 'var(--color-muted-foreground)'
          : 'var(--color-danger)'
  return (
    <span
      className="h-1.5 w-1.5 shrink-0 rounded-full"
      style={{ background: color }}
      aria-label={status}
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
