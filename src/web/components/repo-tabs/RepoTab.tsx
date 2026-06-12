import { AlertCircle, FolderGit2, Server } from 'lucide-react'
import type { RepoTabSummary } from '#/web/components/repo-tabs/types.ts'
import type { FocusRegistry } from '#/web/components/tab-strip/useFocusRegistry.ts'
import { ToolbarClosableTab } from '#/web/components/tab-strip/ToolbarClosableTab.tsx'
import { toolbarTabButtonClassName, toolbarTabChromeClassName, toolbarTabIconClassName } from '#/web/components/tab-strip/tab-variants.ts'
import { useSortableTab } from '#/web/components/tab-strip/useSortableTab.ts'
import { isRemoteRepoId } from '#/shared/remote-repo.ts'
interface RepoTabProps {
  repo: RepoTabSummary
  isActive: boolean
  index: number
  total: number
  showSeparator: boolean
  focusRegistry?: FocusRegistry<string, HTMLButtonElement>
  onHoverChange: (id: string | null) => void
  onActivate: (id: string) => void
  onClose: (id: string) => void
  onKeyboardNavigate: (id: string, direction: 'prev' | 'next' | 'first' | 'last') => void
  closeLabel: (name: string) => string
  unavailableLabel: string
}

export function RepoTab({
  repo,
  isActive,
  index,
  total,
  showSeparator,
  focusRegistry,
  onHoverChange,
  onActivate,
  onClose,
  onKeyboardNavigate,
  closeLabel,
  unavailableLabel,
}: RepoTabProps) {
  const tabLabel = repo.unavailable ? `${repo.name} — ${unavailableLabel}` : repo.name
  const sortable = useSortableTab(repo.id, { onButtonRef: focusRegistry?.setRef(repo.id) })

  return (
    <ToolbarClosableTab
      containerRef={sortable.setContainerRef}
      containerProps={{
        style: sortable.style,
        'data-interactive': true,
        'data-repo-tab-tooltip-id': repo.id,
        role: 'presentation',
        onPointerEnter: () => onHoverChange(repo.id),
        onPointerLeave: () => onHoverChange(null),
      }}
      containerClassName={toolbarTabChromeClassName({ variant: 'repo', active: isActive, dragging: sortable.isDragging })}
      overlay={
        showSeparator ? (
          <span className="pointer-events-none absolute right-0 top-1/2 h-4 -translate-y-1/2 border-r border-separator" />
        ) : null
      }
      buttonRef={sortable.setButtonRef}
      buttonProps={{
        'data-repo-tab-id': repo.id,
        ...sortable.attributes,
        ...sortable.sortableListeners,
        role: 'tab',
        tabIndex: isActive ? 0 : -1,
        'aria-selected': isActive,
        'aria-label': tabLabel,
        'aria-posinset': index + 1,
        'aria-setsize': total,
        onClick: () => onActivate(repo.id),
        onKeyDown: (e) => {
          sortable.sortableOnKeyDown?.(e)
          if (e.defaultPrevented || sortable.isDragging) return
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return
          e.preventDefault()
          onKeyboardNavigate(
            repo.id,
            e.key === 'ArrowLeft' ? 'prev' : e.key === 'ArrowRight' ? 'next' : e.key === 'Home' ? 'first' : 'last',
          )
        },
      }}
      buttonClassName={toolbarTabButtonClassName('repo')}
      closeLabel={closeLabel(repo.name)}
      closeVisible={isActive}
      onClose={(e) => {
        e.stopPropagation()
        onClose(repo.id)
      }}
    >
      {isRemoteRepoId(repo.id) ? (
        <Server size={13} className={toolbarTabIconClassName(isActive)} />
      ) : (
        <FolderGit2 size={13} className={toolbarTabIconClassName(isActive)} />
      )}
      <span className="truncate font-medium">{repo.name}</span>
      {repo.unavailable && <AlertCircle size={12} className="shrink-0 text-warning" aria-hidden />}
    </ToolbarClosableTab>
  )
}
