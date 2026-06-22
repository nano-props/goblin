import { AlertCircle, ChevronDown, FolderGit2, Loader2, Server } from 'lucide-react'
import type { RepoPickerRepo } from '#/web/components/repo-picker/types.ts'
import type { FocusRegistry } from '#/web/components/tab-strip/useFocusRegistry.ts'
import { ToolbarClosableTab } from '#/web/components/tab-strip/ToolbarClosableTab.tsx'
import { toolbarTabChromeClassName } from '#/web/components/tab-strip/tab-variants.ts'
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
      // justify-between pushes the chevron to the trailing edge so
      // the tab reads as a dropdown button rather than a label
      // followed by an ornament; the inner span groups the leading
      // icon + name + status indicators so they stay together when
      // the name truncates.
      buttonClassName="justify-between gap-2"
    >
      <span className="flex min-w-0 items-center gap-1.5">
        {/* Folder/remote icon uses text-foreground directly instead of
         * toolbarTabIconClassName: the shared helper returns
         * text-muted-foreground when compact=true (which the repo
         * variant always is), but the repo chrome now reads in
         * foreground to match the action buttons — the leading icon
         * has to follow suit, otherwise it would look visibly lighter
         * than the repo name beside it. */}
        {isRemote ? (
          <Server size={13} className="shrink-0 text-foreground" />
        ) : (
          <FolderGit2 size={13} className="shrink-0 text-foreground" />
        )}
        <span className="truncate font-medium">{repo.name}</span>
        {showConnecting && (
          <span className="shrink-0 text-muted-foreground" aria-label={connectingTitle} title={connectingTitle}>
            <Loader2 size={12} className="animate-spin" aria-hidden />
          </span>
        )}
        {showFailed && <AlertCircle size={12} className="shrink-0 text-warning" aria-hidden />}
      </span>
      {/* Chevron signals that the tab is a popover trigger; it is
       * always visible (no fade-in affordance) so the discovery
       * signal matches the standard HTML <select> / macOS popup
       * button pattern. Decorative — the button's aria-label already
       * names the repo, so screen readers don't need the chevron. */}
      <ChevronDown size={13} className="shrink-0 text-muted-foreground/70" aria-hidden />
    </ToolbarClosableTab>
  )
}
