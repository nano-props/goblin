import { forwardRef, type ComponentPropsWithoutRef, type KeyboardEvent, type Ref } from 'react'
import { AlertCircle, ChevronDown, FolderGit2, Loader2, Server } from 'lucide-react'
import type { RepoPickerRepo } from '#/web/components/repo-picker/types.ts'
import type { FocusRegistry } from '#/web/components/tab-strip/useFocusRegistry.ts'
import { ToolbarClosableTab } from '#/web/components/tab-strip/ToolbarClosableTab.tsx'
import { toolbarTabChromeClassName } from '#/web/components/tab-strip/tab-variants.ts'
import { useT } from '#/web/stores/i18n.ts'
import { isRemoteRepoId } from '#/shared/remote-repo.ts'
import { cn } from '#/web/lib/cn.ts'
import { SidebarRowButton } from '#/web/components/ui/sidebar-row-button.tsx'

const CURRENT_REPO_ICON_CLASS = 'flex size-3.5 shrink-0 items-center justify-center'

interface CurrentRepoButtonBaseProps {
  repo: RepoPickerRepo
  focusRegistry?: FocusRegistry<string, HTMLButtonElement>
  onKeyboardNavigate: (id: string, direction: 'prev' | 'next' | 'first' | 'last') => void
  unavailableLabel: string
  fill?: boolean
}

interface CurrentRepoToolbarButtonProps extends CurrentRepoButtonBaseProps {
  isCurrent: boolean
  onActivate: (id: string) => void
}

type CurrentRepoSidebarButtonProps = Omit<ComponentPropsWithoutRef<'button'>, 'children' | 'type'> &
  CurrentRepoButtonBaseProps

export function CurrentRepoToolbarButton({
  repo,
  isCurrent,
  focusRegistry,
  onActivate,
  onKeyboardNavigate,
  unavailableLabel,
  fill = false,
}: CurrentRepoToolbarButtonProps) {
  const state = currentRepoButtonState(repo, unavailableLabel)

  return (
    <ToolbarClosableTab
      containerProps={{
        'data-interactive': true,
        'data-current-repo-chrome': true,
      }}
      containerClassName={cn(
        toolbarTabChromeClassName({
          variant: 'repo',
          active: isCurrent,
          compact: true,
        }),
        fill && 'max-w-none flex-1',
      )}
      buttonRef={focusRegistry?.setRef(repo.id)}
      buttonProps={{
        'data-current-repo-id': repo.id,
        'data-current-repo-connecting': state.showConnecting ? 'true' : undefined,
        role: 'tab',
        tabIndex: isCurrent ? 0 : -1,
        'aria-selected': isCurrent,
        'aria-label': state.repoLabel,
        onClick: () => onActivate(repo.id),
        onKeyDown: (event) => handleRepoKeyboardNavigation(event, repo.id, onKeyboardNavigate),
      }}
      closeButton={false}
      // justify-between pushes the chevron to the trailing edge so
      // the tab reads as a dropdown button rather than a label
      // followed by an ornament; the inner span groups the leading
      // icon + name + status indicators so they stay together when
      // the name truncates.
      buttonClassName="justify-between gap-2"
    >
      <CurrentRepoButtonLeading repo={repo} state={state} />
      {/* Chevron signals that the tab is a popover trigger; it is
       * always visible (no fade-in affordance) so the discovery
       * signal matches the standard HTML <select> / macOS popup
       * button pattern. Decorative — the button's aria-label already
       * names the repo, so screen readers don't need the chevron. */}
      <ChevronDown size={13} className="shrink-0 text-muted-foreground/70" aria-hidden />
    </ToolbarClosableTab>
  )
}

export const CurrentRepoSidebarButton = forwardRef<HTMLButtonElement, CurrentRepoSidebarButtonProps>(
  function CurrentRepoSidebarButton(
    { repo, focusRegistry, onKeyboardNavigate, unavailableLabel, fill = false, className, onKeyDown, ...buttonProps },
    forwardedRef,
  ) {
    const state = currentRepoButtonState(repo, unavailableLabel)
    const registryRef = focusRegistry?.setRef(repo.id)

    return (
      <SidebarRowButton
        {...buttonProps}
        ref={(node) => {
          registryRef?.(node)
          assignRef(forwardedRef, node)
        }}
        data-current-repo-chrome
        data-current-repo-id={repo.id}
        data-current-repo-connecting={state.showConnecting ? 'true' : undefined}
        className={className}
        aria-label={state.repoLabel}
        fill={fill}
        leading={<CurrentRepoButtonIcon repo={repo} size={16} />}
        trailing={<ChevronDown size={14} aria-hidden />}
        contentClassName="flex min-w-0 flex-1 items-center gap-2"
        onKeyDown={(event) => {
          onKeyDown?.(event)
          if (!event.defaultPrevented) handleRepoKeyboardNavigation(event, repo.id, onKeyboardNavigate)
        }}
      >
        <CurrentRepoButtonText repo={repo} state={state} />
      </SidebarRowButton>
    )
  },
)

function currentRepoButtonState(repo: RepoPickerRepo, unavailableLabel: string) {
  const showConnecting = repo.lifecycle?.kind === 'connecting'
  const showFailed = repo.lifecycle?.kind === 'failed'
  return {
    showConnecting,
    showFailed,
    repoLabel: showFailed ? `${repo.name} — ${unavailableLabel}` : repo.name,
  }
}

function CurrentRepoButtonLeading({
  repo,
  state,
}: {
  repo: RepoPickerRepo
  state: ReturnType<typeof currentRepoButtonState>
}) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className={CURRENT_REPO_ICON_CLASS}>
        <CurrentRepoButtonIcon repo={repo} size={14} />
      </span>
      <CurrentRepoButtonText repo={repo} state={state} />
    </span>
  )
}

function CurrentRepoButtonIcon({ repo, size }: { repo: RepoPickerRepo; size: number }) {
  const RepoIcon = isRemoteRepoId(repo.id) ? Server : FolderGit2
  return <RepoIcon size={size} className="text-foreground" aria-hidden />
}

function CurrentRepoButtonText({
  repo,
  state,
}: {
  repo: RepoPickerRepo
  state: ReturnType<typeof currentRepoButtonState>
}) {
  const t = useT()
  const connectingTitle = t('repo-picker.connecting-title')
  return (
    <>
      <span className="truncate font-medium uppercase">{repo.name}</span>
      {state.showConnecting && (
        <span className="shrink-0 text-muted-foreground" aria-label={connectingTitle} title={connectingTitle}>
          <Loader2 size={12} className="animate-spin" aria-hidden />
        </span>
      )}
      {state.showFailed && <AlertCircle size={12} className="shrink-0 text-warning" aria-hidden />}
    </>
  )
}

function handleRepoKeyboardNavigation(
  event: KeyboardEvent<HTMLButtonElement>,
  repoId: string,
  onKeyboardNavigate: CurrentRepoButtonBaseProps['onKeyboardNavigate'],
) {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return
  event.preventDefault()
  onKeyboardNavigate(
    repoId,
    event.key === 'ArrowLeft' ? 'prev' : event.key === 'ArrowRight' ? 'next' : event.key === 'Home' ? 'first' : 'last',
  )
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (!ref) return
  if (typeof ref === 'function') {
    ref(value)
    return
  }
  ref.current = value
}
