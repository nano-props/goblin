import { AlertCircle, FolderGit2, Loader2, Server } from 'lucide-react'
import type { RepoTabSummary } from '#/web/components/repo-tabs/types.ts'
import type { FocusRegistry } from '#/web/components/tab-strip/useFocusRegistry.ts'
import { ToolbarClosableTab } from '#/web/components/tab-strip/ToolbarClosableTab.tsx'
import {
  toolbarTabButtonClassName,
  toolbarTabChromeClassName,
  toolbarTabIconClassName,
} from '#/web/components/tab-strip/tab-variants.ts'
import { useSortableTab } from '#/web/components/tab-strip/useSortableTab.ts'
import { useT } from '#/web/stores/i18n.ts'
import { isRemoteRepoId } from '#/shared/remote-repo.ts'
interface RepoTabProps {
  repo: RepoTabSummary
  isActive: boolean
  index: number
  total: number
  showSeparator: boolean
  focusRegistry?: FocusRegistry<string, HTMLButtonElement>
  onActivate: (id: string) => void
  onClose: (id: string) => void
  onKeyboardNavigate: (id: string, direction: 'prev' | 'next' | 'first' | 'last') => void
  closeLabel: (name: string) => string
  unavailableLabel: string
  // Compact strips render only the visible repo tab; it should look like
  // an unselected tab on the expanded strip, so the chrome falls back to
  // the muted "idle" palette.
  compact?: boolean
}

export function RepoTab({
  repo,
  isActive,
  index,
  total,
  showSeparator,
  focusRegistry,
  onActivate,
  onClose,
  onKeyboardNavigate,
  closeLabel,
  unavailableLabel,
  compact = false,
}: RepoTabProps) {
  const t = useT()
  const sortable = useSortableTab(repo.id, { onButtonRef: focusRegistry?.setRef(repo.id) })
  const isRemote = isRemoteRepoId(repo.id)
  // A remote tab's chrome is driven entirely by the lifecycle
  // union: 'connecting' → spinner, 'failed' → warning badge,
  // 'ready' (or null for local) → plain tab.
  const lifecycle = repo.lifecycle
  const showConnecting = lifecycle?.kind === 'connecting'
  const showFailed = lifecycle?.kind === 'failed'
  // Phase 1 keeps the legacy `unavailable` boolean in sync via the
  // markRemoteLifecycleFailed helper, so the existing tooltip /
  // aria-label path keeps working. Once Phase 4 removes the legacy
  // field, the union is the only signal.
  const tabLabel = showFailed ? `${repo.name} — ${unavailableLabel}` : repo.name
  const connectingTitle = t('repo-tabs.connecting-title')

  return (
    <ToolbarClosableTab
      containerRef={sortable.setContainerRef}
      containerProps={{
        style: sortable.style,
        'data-interactive': true,
        'data-repo-tab-tooltip-id': repo.id,
        role: 'presentation',
      }}
      containerClassName={toolbarTabChromeClassName({
        variant: 'repo',
        active: isActive,
        dragging: sortable.isDragging,
        compact,
      })}
      overlay={
        showSeparator ? (
          <span className="pointer-events-none absolute right-0 top-1/2 h-4 -translate-y-1/2 border-r border-separator" />
        ) : null
      }
      buttonRef={sortable.setButtonRef}
      buttonProps={{
        'data-repo-tab-id': repo.id,
        'data-repo-tab-connecting': showConnecting ? 'true' : undefined,
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
      closeVisible={false}
      closeButton={false}
      onClose={(e) => {
        e.stopPropagation()
        onClose(repo.id)
      }}
    >
      {isRemote ? (
        <Server size={13} className={toolbarTabIconClassName(isActive, compact)} />
      ) : (
        <FolderGit2 size={13} className={toolbarTabIconClassName(isActive, compact)} />
      )}
      <span className="truncate font-medium">{repo.name}</span>
      {showConnecting && (
        <span className="shrink-0 text-muted-foreground" aria-label={connectingTitle} title={connectingTitle}>
          <Loader2 size={12} className="animate-spin" aria-hidden />
        </span>
      )}
      {showFailed && <AlertCircle size={12} className="shrink-0 text-warning" aria-hidden />}
    </ToolbarClosableTab>
  )
}
