import { useContext, type ReactNode } from 'react'
import { Settings } from 'lucide-react'
import { BranchNavigator } from '#/web/components/BranchNavigator.tsx'
import { RepoPickerHost } from '#/web/components/RepoPickerHost.tsx'
import {
  BranchFilterAction,
  CreateWorktreeRowAction,
  DashboardRowAction,
  RepoSyncAction,
} from '#/web/components/repo-toolbar/RepoToolbarActions.tsx'
import { useT } from '#/web/stores/i18n.ts'
import { LayoutOverlayActions } from '#/web/layout-overlay-actions-context.ts'
import { SidebarRowButton } from '#/web/components/ui/sidebar-row-button.tsx'
import { TITLE_BAR_HEIGHT_PX } from '#/shared/title-bar-chrome.ts'
import { TitleBarDragRegion } from '#/web/components/title-bar-chrome-region.tsx'

const NOOP = () => {}
const SIDEBAR_TOP_CLASS_NAME = 'flex shrink-0 items-center gap-1 bg-card text-sm'
type RepoShellSidebarChromeRegion = 'drag' | 'none'

interface RepoShellSidebarProps {
  repoId?: string
  compact: boolean
  branchContent?: ReactNode
  chromeRegion?: RepoShellSidebarChromeRegion
  onOpenSettings?: () => void
  onSelectBranch?: (branch: string) => void
  onCreateWorktree?: () => void
  onOpenDashboard?: () => void
  dashboardSelected?: boolean
  newWorktreeSelected?: boolean
  currentBranchName?: string | null
  gitAvailable?: boolean
}

export function RepoLayoutSidebar({
  repoId,
  compact,
  branchContent,
  chromeRegion = 'drag',
  onOpenSettings,
  onSelectBranch,
  onCreateWorktree,
  onOpenDashboard,
  dashboardSelected = false,
  newWorktreeSelected = false,
  currentBranchName,
  gitAvailable = true,
}: RepoShellSidebarProps) {
  const t = useT()
  return (
    <aside className="flex min-h-0 min-w-0 flex-1 flex-col bg-card">
      {!compact &&
        (chromeRegion === 'drag' ? (
          <TitleBarDragRegion
            className={SIDEBAR_TOP_CLASS_NAME}
            data-testid="repo-shell-sidebar-top"
            style={{ height: TITLE_BAR_HEIGHT_PX }}
          />
        ) : (
          <div
            className={SIDEBAR_TOP_CLASS_NAME}
            data-testid="repo-shell-sidebar-top"
            style={{ height: TITLE_BAR_HEIGHT_PX }}
          />
        ))}
      <RepoShellPrimaryActions
        repoId={repoId}
        onCreateWorktree={onCreateWorktree}
        onOpenDashboard={onOpenDashboard}
        dashboardSelected={dashboardSelected}
        newWorktreeSelected={newWorktreeSelected}
        gitAvailable={gitAvailable}
      />
      {repoId && gitAvailable ? (
        <>
          <RepoShellBranchHeader repoId={repoId} title={t('tab.branches')} />
          <div className="flex min-h-0 flex-1 bg-card">
            {branchContent ?? (
              <BranchNavigator repoId={repoId} onSelectBranch={onSelectBranch} currentBranchName={currentBranchName} />
            )}
          </div>
        </>
      ) : (
        <div className="flex min-h-0 flex-1 bg-card" />
      )}
      <SidebarSettingsButton onOpenSettings={onOpenSettings} />
    </aside>
  )
}

function RepoShellPrimaryActions({
  repoId,
  onCreateWorktree,
  onOpenDashboard,
  dashboardSelected,
  newWorktreeSelected,
  gitAvailable,
}: {
  repoId?: string
  onCreateWorktree?: () => void
  onOpenDashboard?: () => void
  dashboardSelected?: boolean
  newWorktreeSelected?: boolean
  gitAvailable: boolean
}) {
  return (
    <div className="shrink-0 px-3 pt-4">
      <div className="flex min-w-0 flex-col gap-1">
        <RepoPickerRow repoId={repoId} />
        {repoId && gitAvailable ? (
          <>
            <DashboardRowAction repoId={repoId} selected={dashboardSelected} onOpenDashboard={onOpenDashboard} />
            <CreateWorktreeRowAction
              repoId={repoId}
              selected={newWorktreeSelected}
              onCreateWorktree={onCreateWorktree}
            />
          </>
        ) : null}
      </div>
    </div>
  )
}

function RepoPickerRow({ repoId }: { repoId?: string }) {
  const overlayActions = useContext(LayoutOverlayActions)
  return (
    <div className="flex h-8 min-w-0 shrink-0 items-center">
      <RepoPickerHost
        currentRepoId={repoId ?? null}
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
      aria-label={t('app-chrome.settings')}
      onClick={() => onOpenSettings?.()}
      leading={<Settings size={16} />}
    >
      {t('app-chrome.settings-tooltip')}
    </SidebarRowButton>
  )
  return <div className="relative z-10 shrink-0 bg-card p-2">{button}</div>
}
