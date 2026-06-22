import { AlertCircle, FolderGit2, Loader2, Server } from 'lucide-react'
import type { RepoPickerRepo } from '#/web/components/repo-picker/types.ts'
import type { FocusRegistry } from '#/web/components/tab-strip/useFocusRegistry.ts'
import { ToolbarClosableTab } from '#/web/components/tab-strip/ToolbarClosableTab.tsx'
import { toolbarTabChromeClassName, toolbarTabIconClassName } from '#/web/components/tab-strip/tab-variants.ts'
import { useT } from '#/web/stores/i18n.ts'
import { isRemoteRepoId } from '#/shared/remote-repo.ts'

interface CurrentRepoButtonProps {
  repo: RepoPickerRepo
  isCurrent: boolean
  focusRegistry?: FocusRegistry<string, HTMLButtonElement>
  onActivate: (id: string) => void
  onKeyboardNavigate: (id: string, direction: 'prev' | 'next' | 'first' | 'last') => void
  unavailableLabel: string
}

export function CurrentRepoButton({
  repo,
  isCurrent,
  focusRegistry,
  onActivate,
  onKeyboardNavigate,
  unavailableLabel,
}: CurrentRepoButtonProps) {
  const t = useT()
  const isRemote = isRemoteRepoId(repo.id)
  const lifecycle = repo.lifecycle
  const showConnecting = lifecycle?.kind === 'connecting'
  const showFailed = lifecycle?.kind === 'failed'
  const repoLabel = showFailed ? `${repo.name} — ${unavailableLabel}` : repo.name
  const connectingTitle = t('repo-picker.connecting-title')

  return (
    <ToolbarClosableTab
      containerProps={{
        'data-interactive': true,
        'data-current-repo-chrome': true,
        'data-repo-tooltip-id': repo.id,
      }}
      containerClassName={toolbarTabChromeClassName({
        variant: 'repo',
        active: isCurrent,
        compact: true,
      })}
      buttonRef={focusRegistry?.setRef(repo.id)}
      buttonProps={{
        'data-current-repo-id': repo.id,
        'data-current-repo-connecting': showConnecting ? 'true' : undefined,
        role: 'tab',
        tabIndex: isCurrent ? 0 : -1,
        'aria-selected': isCurrent,
        'aria-label': repoLabel,
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
        <Server size={13} className={toolbarTabIconClassName(isCurrent, true)} />
      ) : (
        <FolderGit2 size={13} className={toolbarTabIconClassName(isCurrent, true)} />
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
