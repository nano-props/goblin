import type { KeyboardEvent } from 'react'
import { FolderGit2, X } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '#/renderer/lib/cn.ts'
import type { RepoTabSummary } from '#/renderer/components/repo-tabs/types.ts'

interface RepoTabProps {
  repo: RepoTabSummary
  isActive: boolean
  showSeparator: boolean
  onHoverChange: (id: string | null) => void
  onActivate: (id: string) => void
  onClose: (id: string) => void
  closeLabel: string
  dragLabel: string
}

export function RepoTab({
  repo,
  isActive,
  showSeparator,
  onHoverChange,
  onActivate,
  onClose,
  closeLabel,
  dragLabel,
}: RepoTabProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: repo.id,
  })
  const sortableListeners = listeners ?? {}
  const onSortableKeyDown = sortableListeners.onKeyDown as ((event: KeyboardEvent<HTMLDivElement>) => void) | undefined
  const chromeLikeTransform = transform ? { ...transform, y: 0, scaleX: 1, scaleY: 1 } : null
  const style = {
    transform: CSS.Transform.toString(chromeLikeTransform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-interactive
      {...attributes}
      {...sortableListeners}
      role="tab"
      tabIndex={0}
      aria-selected={isActive}
      aria-label={`${repo.name}. ${dragLabel}`}
      onPointerEnter={() => onHoverChange(repo.id)}
      onPointerLeave={() => onHoverChange(null)}
      onClick={() => onActivate(repo.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          onActivate(repo.id)
          return
        }
        onSortableKeyDown?.(e)
      }}
      className={cn(
        'group relative flex h-8 min-w-36 max-w-56 shrink-0 cursor-pointer touch-none select-none items-center gap-1.5 rounded-md border px-2 text-xs transition-colors duration-100',
        isActive
          ? 'border-border bg-background text-foreground shadow-sm'
          : 'border-transparent text-muted-foreground hover:bg-accent/70 hover:text-foreground',
        isDragging && 'z-10 cursor-grabbing bg-background shadow-sm ring-1 ring-border',
      )}
      title={repo.name}
    >
      {isActive && <span className="absolute inset-x-2 -bottom-px h-px rounded-full bg-brand" />}
      {showSeparator && (
        <span className="pointer-events-none absolute right-0 top-1/2 h-4 -translate-y-1/2 border-r border-border/70" />
      )}
      <div className="flex h-full min-w-0 flex-1 items-center gap-1.5">
        <FolderGit2 size={13} className={cn('shrink-0', isActive ? 'text-foreground' : 'text-muted-foreground')} />
        <span className="truncate font-medium">{repo.name}</span>
      </div>
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          onClose(repo.id)
        }}
        className={cn(
          'cursor-pointer rounded p-0.5 text-muted-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground',
          isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
        )}
        title={closeLabel}
        aria-label={closeLabel}
      >
        <X size={14} />
      </button>
    </div>
  )
}
