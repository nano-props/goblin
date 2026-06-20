import { AlertCircle, FolderGit2, Loader2, Server } from 'lucide-react'
import type { RepoTabSummary } from '#/web/components/repo-tabs/types.ts'
import type { FocusRegistry } from '#/web/components/tab-strip/useFocusRegistry.ts'
import { ToolbarClosableTab } from '#/web/components/tab-strip/ToolbarClosableTab.tsx'
import { toolbarTabChromeClassName, toolbarTabIconClassName } from '#/web/components/tab-strip/tab-variants.ts'
import { useT } from '#/web/stores/i18n.ts'
import { isRemoteRepoId } from '#/shared/remote-repo.ts'
interface RepoTabProps {
  repo: RepoTabSummary
  isActive: boolean
  index: number
  total: number
  focusRegistry?: FocusRegistry<string, HTMLButtonElement>
  onActivate: (id: string) => void
  onKeyboardNavigate: (id: string, direction: 'prev' | 'next' | 'first' | 'last') => void
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
  focusRegistry,
  onActivate,
  onKeyboardNavigate,
  unavailableLabel,
  compact = false,
}: RepoTabProps) {
  const t = useT()
  const isRemote = isRemoteRepoId(repo.id)
  // A remote tab's chrome is driven entirely by the lifecycle
  // union: 'connecting' → spinner, 'failed' → warning badge,
  // 'ready' (or null for local) → plain tab.
  const lifecycle = repo.lifecycle
  const showConnecting = lifecycle?.kind === 'connecting'
  const showFailed = lifecycle?.kind === 'failed'
  const tabLabel = showFailed ? `${repo.name} — ${unavailableLabel}` : repo.name
  const connectingTitle = t('repo-tabs.connecting-title')

  return (
    <ToolbarClosableTab
      containerProps={{
        'data-interactive': true,
        'data-repo-tab-tooltip-id': repo.id,
        role: 'presentation',
      }}
      containerClassName={toolbarTabChromeClassName({
        variant: 'repo',
        active: isActive,
        compact,
      })}
      buttonRef={focusRegistry?.setRef(repo.id)}
      buttonProps={{
        'data-repo-tab-id': repo.id,
        'data-repo-tab-connecting': showConnecting ? 'true' : undefined,
        role: 'tab',
        tabIndex: isActive ? 0 : -1,
        'aria-selected': isActive,
        'aria-label': tabLabel,
        'aria-posinset': index + 1,
        'aria-setsize': total,
        onClick: () => onActivate(repo.id),
        onKeyDown: (e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return
          e.preventDefault()
          onKeyboardNavigate(
            repo.id,
            e.key === 'ArrowLeft' ? 'prev' : e.key === 'ArrowRight' ? 'next' : e.key === 'Home' ? 'first' : 'last',
          )
        },
      }}
      closeButton={false}
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
