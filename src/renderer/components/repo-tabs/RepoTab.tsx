import { AlertCircle, FolderGit2, Globe, X } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '#/renderer/lib/cn.ts'
import { compositeFocusRing } from '#/renderer/components/ui/focus.ts'
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
  unavailableLabel: string
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
  unavailableLabel,
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
  const tabLabel = repo.unavailable ? `${repo.name} — ${unavailableLabel}` : repo.name

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-interactive
      data-repo-tab-tooltip-id={repo.id}
      role="presentation"
      onPointerEnter={() => onHoverChange(repo.id)}
      onPointerLeave={() => onHoverChange(null)}
      className={cn(
        'group relative flex h-8 min-w-36 max-w-56 shrink-0 touch-none select-none items-center gap-1.5 rounded-md border px-2 text-xs transition-colors duration-100',
        compositeFocusRing,
        isActive
          ? 'border-input bg-card text-foreground'
          : 'border-transparent text-muted-foreground hover:bg-accent/70 hover:text-foreground',
        isDragging && 'z-10 cursor-grabbing bg-card text-foreground',
      )}
    >
      {showSeparator && (
        <span className="pointer-events-none absolute right-0 top-1/2 h-4 -translate-y-1/2 border-r border-separator" />
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
        aria-label={tabLabel}
        onClick={() => onActivate(repo.id)}
        onKeyDown={(e) => {
          if (!isDragging && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End')) {
            e.preventDefault()
            onKeyboardNavigate(
              repo.id,
              e.key === 'ArrowLeft' ? 'prev' : e.key === 'ArrowRight' ? 'next' : e.key === 'Home' ? 'first' : 'last',
            )
          }
        }}
        className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-sm border-0 bg-transparent p-0 text-left text-inherit outline-none"
      >
        {repo.id.startsWith('ssh://') ? (
          <Globe size={13} className={cn('shrink-0', isActive ? 'text-foreground' : 'text-muted-foreground')} />
        ) : (
          <FolderGit2 size={13} className={cn('shrink-0', isActive ? 'text-foreground' : 'text-muted-foreground')} />
        )}
        <span className="truncate font-medium">{repo.name}</span>
        {repo.unavailable && <AlertCircle size={12} className="shrink-0 text-warning" aria-hidden />}
      </button>
      <button
        type="button"
        // Keep the tablist on roving tab focus; close stays pointer/menu
        // accessible instead of adding an extra Tab stop inside every tab.
        tabIndex={-1}
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
