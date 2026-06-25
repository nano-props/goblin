import { useContext, type ReactNode } from 'react'
import { Settings } from 'lucide-react'
import { BranchNavigator } from '#/web/components/BranchNavigator.tsx'
import { RepoPickerHost } from '#/web/components/RepoPickerHost.tsx'
import {
  BranchFilterAction,
  CreateWorktreeRowAction,
  RepoSyncAction,
} from '#/web/components/repo-toolbar/RepoToolbarActions.tsx'
import { useT } from '#/web/stores/i18n.ts'
import { LayoutOverlayActions } from '#/web/layout-overlay-actions-context.ts'
import { SidebarRowButton } from '#/web/components/ui/sidebar-row-button.tsx'
import { WINDOW_TOPBAR_HEIGHT_PX } from '#/shared/window-chrome.ts'

const NOOP = () => {}

interface RepoShellSidebarProps {
  repoId: string
  compact: boolean
  branchContent?: ReactNode
  surface?: 'docked' | 'floating'
  onOpenSettings?: () => void
}

export function RepoShellSidebar({
  repoId,
  compact,
  branchContent,
  surface = 'docked',
  onOpenSettings,
}: RepoShellSidebarProps) {
  const t = useT()
  return (
    <aside className="flex min-h-0 min-w-0 flex-1 flex-col bg-card">
      {!compact && (
        <div
          className="topbar flex shrink-0 items-center gap-1 bg-card text-sm"
          data-interactive={surface === 'floating' ? true : undefined}
          data-testid="repo-shell-sidebar-top"
          style={{ height: WINDOW_TOPBAR_HEIGHT_PX }}
        />
      )}
      <RepoShellPrimaryActions repoId={repoId} />
      <RepoShellBranchHeader repoId={repoId} title={t('tab.branches')} />
      <div className="flex min-h-0 flex-1 bg-card">
        {branchContent ?? <BranchNavigator repoId={repoId} />}
      </div>
      <SidebarSettingsButton onOpenSettings={onOpenSettings} />
    </aside>
  )
}

function RepoShellPrimaryActions({ repoId }: { repoId: string }) {
  return (
    <div className="shrink-0 px-3 pt-4">
      <div className="flex min-w-0 flex-col gap-0">
        <RepoPickerRow repoId={repoId} />
        <CreateWorktreeRowAction repoId={repoId} />
      </div>
    </div>
  )
}

function RepoPickerRow({ repoId }: { repoId: string }) {
  const overlayActions = useContext(LayoutOverlayActions)
  return (
    <div className="flex h-8 min-w-0 shrink-0 items-center">
      <RepoPickerHost
        currentRepoId={repoId}
        onOpenRepoPathDialog={overlayActions?.openRepoPathDialog ?? NOOP}
        onOpenRemote={overlayActions?.openRemoteRepo ?? NOOP}
        onClone={overlayActions?.openCloneRepo ?? NOOP}
        surface="sidebar"
      />
    </div>
  )
}

function RepoShellBranchHeader({ repoId, title }: { repoId: string; title: string }) {
  return (
    <div className="shrink-0 px-3 pb-2 pt-3">
      <div className="flex h-8 min-w-0 items-center gap-2 px-3">
        <div className="min-w-0 flex-1 truncate text-[13px] font-semibold text-muted-foreground">{title}</div>
        <BranchFilterAction repoId={repoId} />
        <RepoSyncAction repoId={repoId} />
      </div>
    </div>
  )
}

function SidebarSettingsButton({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const t = useT()
  const button = (
    <SidebarRowButton
      aria-label={t('topbar.settings')}
      onClick={() => onOpenSettings?.()}
      leading={<Settings size={16} />}
    >
      {t('topbar.settings-tooltip')}
    </SidebarRowButton>
  )
  return (
    <div className="relative z-10 shrink-0 bg-card p-2">
      {button}
    </div>
  )
}
