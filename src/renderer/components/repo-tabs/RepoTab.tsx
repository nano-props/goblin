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
  onKeyboardNavigate: (id: string, direction: 'prev' | 'next' | 'first' | 'last') => void
  closeLabel: string
}

export function RepoTab({
  repo,
  isActive,
  showSeparator,
  onHoverChange,
  onActivate,
  onClose,
  onKeyboardNavigate,
  closeLabel,
}: RepoTabProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: repo.id,
  })
  const sortableListeners = listeners ?? {}
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
      role="presentation"
      onPointerEnter={() => onHoverChange(repo.id)}
      onPointerLeave={() => onHoverChange(null)}
      className={cn(
        'group relative flex h-8 min-w-36 max-w-56 shrink-0 touch-none select-none items-center gap-1.5 rounded-md border px-2 text-xs transition-colors duration-100 [&:has(:focus-visible)]:outline-2 [&:has(:focus-visible)]:-outline-offset-2 [&:has(:focus-visible)]:outline-ring',
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
      <button
        ref={setActivatorNodeRef}
        type="button"
        data-repo-tab-id={repo.id}
        {...attributes}
        {...sortableListeners}
        role="tab"
        tabIndex={isActive ? 0 : -1}
        aria-selected={isActive}
        aria-label={repo.name}
        onClick={() => onActivate(repo.id)}
        onKeyDown={(e) => {
          if (!isDragging && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End')) {
            e.preventDefault()
            onKeyboardNavigate(
              repo.id,
              e.key === 'ArrowLeft' ? 'prev' : e.key === 'ArrowRight' ? 'next' : e.key === 'Home' ? 'first' : 'last',
            )
            return
          }
          if (e.key === 'Enter') {
            e.preventDefault()
            onActivate(repo.id)
            return
          }
        }}
        className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-sm border-0 bg-transparent p-0 text-left text-inherit outline-none"
        title={repo.name}
      >
        <FolderGit2 size={13} className={cn('shrink-0', isActive ? 'text-foreground' : 'text-muted-foreground')} />
        <span className="truncate font-medium">{repo.name}</span>
      </button>
      <button
        type="button"
        aria-label={closeLabel}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          onClose(repo.id)
        }}
        className={cn(
          'cursor-pointer rounded border-0 bg-transparent p-0.5 text-muted-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground',
          isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
        )}
        title={closeLabel}
      >
        <X size={14} />
      </button>
    </div>
  )
}
