import { useContext, type ReactNode } from 'react'
import { Settings } from 'lucide-react'
import { BranchNavigator } from '#/web/components/BranchNavigator.tsx'
import { WorkspaceRootNavigator } from '#/web/components/branch-navigator/WorkspaceRootNavigator.tsx'
import { WorkspacePickerHost } from '#/web/components/WorkspacePickerHost.tsx'
import {
  BranchFilterAction,
  CreateWorktreeRowAction,
  DashboardRowAction,
  RepoSyncAction,
} from '#/web/components/repo-toolbar/RepoToolbarActions.tsx'
import { WorkspaceRefreshAction } from '#/web/components/workspace-toolbar/WorkspaceRefreshAction.tsx'
import { useT } from '#/web/stores/i18n.ts'
import { LayoutOverlayActions } from '#/web/layout-overlay-actions-context.ts'
import { SidebarRowButton } from '#/web/components/ui/sidebar-row-button.tsx'
import { TITLE_BAR_HEIGHT_PX } from '#/shared/title-bar-chrome.ts'
import { TitleBarDragRegion } from '#/web/components/title-bar-chrome-region.tsx'
import type { GitWorkspaceProjection } from '#/web/stores/workspaces/types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

const NOOP = () => {}
const SIDEBAR_TOP_CLASS_NAME = 'flex shrink-0 items-center gap-1 bg-card text-sm'
type WorkspaceShellSidebarChromeRegion = 'drag' | 'none'

interface WorkspaceShellSidebarProps {
  workspaceId?: WorkspaceId
  git: GitWorkspaceProjection | null
  compact: boolean
  branchContent?: ReactNode
  chromeRegion?: WorkspaceShellSidebarChromeRegion
  onOpenSettings?: () => void
  onSelectBranch?: (branch: string) => void
  onCreateWorktree?: () => void
  onOpenDashboard?: () => void
  dashboardSelected?: boolean
  newWorktreeSelected?: boolean
  currentBranchName?: string | null
  workspaceRootSelected?: boolean
  onSelectWorkspaceRoot?: () => void
}

export function WorkspaceLayoutSidebar({
  workspaceId,
  git,
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
  workspaceRootSelected = false,
  onSelectWorkspaceRoot,
}: WorkspaceShellSidebarProps) {
  const t = useT()
  const navigatorTitleKey = git ? 'tab.branches' : 'workspace.navigation-title'
  return (
    <aside className="flex min-h-0 min-w-0 flex-1 flex-col bg-card">
      {!compact &&
        (chromeRegion === 'drag' ? (
          <TitleBarDragRegion
            className={SIDEBAR_TOP_CLASS_NAME}
            data-testid="workspace-shell-sidebar-top"
            style={{ height: TITLE_BAR_HEIGHT_PX }}
          />
        ) : (
          <div
            className={SIDEBAR_TOP_CLASS_NAME}
            data-testid="workspace-shell-sidebar-top"
            style={{ height: TITLE_BAR_HEIGHT_PX }}
          />
        ))}
      <WorkspaceShellPrimaryActions
        workspaceId={workspaceId}
        onCreateWorktree={onCreateWorktree}
        onOpenDashboard={onOpenDashboard}
        dashboardSelected={dashboardSelected}
        newWorktreeSelected={newWorktreeSelected}
        gitAvailable={git !== null}
      />
      {workspaceId ? (
        <>
          <WorkspaceShellNavigatorHeader
            workspaceId={workspaceId}
            title={t(navigatorTitleKey)}
            gitAvailable={git !== null}
          />
          <div className="flex min-h-0 flex-1 bg-card">
            {branchContent ??
              (git ? (
                <BranchNavigator
                  repoId={workspaceId}
                  onSelectBranch={onSelectBranch}
                  currentBranchName={currentBranchName}
                />
              ) : (
                <WorkspaceRootNavigator
                  workspaceId={workspaceId}
                  selected={workspaceRootSelected}
                  onSelect={onSelectWorkspaceRoot}
                />
              ))}
          </div>
        </>
      ) : (
        <div className="flex min-h-0 flex-1 bg-card" />
      )}
      <SidebarSettingsButton onOpenSettings={onOpenSettings} />
    </aside>
  )
}

function WorkspaceShellPrimaryActions({
  workspaceId,
  onCreateWorktree,
  onOpenDashboard,
  dashboardSelected,
  newWorktreeSelected,
  gitAvailable,
}: {
  workspaceId?: WorkspaceId
  onCreateWorktree?: () => void
  onOpenDashboard?: () => void
  dashboardSelected?: boolean
  newWorktreeSelected?: boolean
  gitAvailable: boolean
}) {
  return (
    <div className="shrink-0 px-3 pt-4">
      <div className="flex min-w-0 flex-col gap-1">
        <WorkspacePickerRow workspaceId={workspaceId} />
        {workspaceId ? (
          <>
            <DashboardRowAction selected={dashboardSelected} onOpenDashboard={onOpenDashboard} />
            {gitAvailable ? (
              <CreateWorktreeRowAction
                repoId={workspaceId}
                selected={newWorktreeSelected}
                onCreateWorktree={onCreateWorktree}
              />
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  )
}

function WorkspacePickerRow({ workspaceId }: { workspaceId?: WorkspaceId }) {
  const overlayActions = useContext(LayoutOverlayActions)
  return (
    <div className="flex h-8 min-w-0 shrink-0 items-center">
      <WorkspacePickerHost
        currentWorkspaceId={workspaceId ?? null}
        onOpenWorkspacePathDialog={overlayActions?.openWorkspacePathDialog ?? NOOP}
        onOpenRemote={overlayActions?.openRemoteWorkspace ?? NOOP}
        onClone={overlayActions?.openCloneRepo ?? NOOP}
        surface="sidebar"
      />
    </div>
  )
}

function WorkspaceShellNavigatorHeader({
  workspaceId,
  title,
  gitAvailable,
}: {
  workspaceId: WorkspaceId
  title: string
  gitAvailable: boolean
}) {
  return (
    <div className="shrink-0 px-3 pb-2 pt-3">
      <div className="flex h-8 min-w-0 items-center gap-2 px-3">
        <div className="min-w-0 flex-1 truncate text-[13px] font-semibold text-muted-foreground">{title}</div>
        {gitAvailable ? <BranchFilterAction repoId={workspaceId} /> : null}
        {gitAvailable ? <RepoSyncAction repoId={workspaceId} /> : <WorkspaceRefreshAction workspaceId={workspaceId} />}
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
