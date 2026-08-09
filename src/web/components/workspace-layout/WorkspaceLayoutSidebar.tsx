import { Settings } from '@lucide/vue'
import { defineComponent } from 'vue'
import type { FunctionalComponent, VNodeChild } from 'vue'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { TITLE_BAR_HEIGHT_PX } from '#/shared/title-bar-chrome.ts'
import { BranchNavigator } from '#/web/components/BranchNavigator.tsx'
import { WorkspacePickerHost } from '#/web/components/WorkspacePickerHost.tsx'
import { WorkspaceRootNavigator } from '#/web/components/branch-navigator/WorkspaceRootNavigator.tsx'
import {
  BranchFilterAction,
  CreateWorktreeRowAction,
  RepoSyncAction,
} from '#/web/components/repo-toolbar/RepoToolbarActions.tsx'
import { TitleBarDragRegion } from '#/web/components/title-bar-chrome-region.tsx'
import { SidebarRowButton } from '#/web/components/ui/sidebar-row-button.tsx'
import { WorkspaceDashboardRowAction } from '#/web/components/workspace-layout/WorkspaceDashboardRowAction.tsx'
import { WorkspaceRefreshAction } from '#/web/components/workspace-toolbar/WorkspaceRefreshAction.tsx'
import { useLayoutOverlayActions } from '#/web/layout-overlay-actions-context.ts'
import { cn } from '#/web/lib/cn.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import type { GitWorkspaceClientState } from '#/web/stores/workspaces/types.ts'

const NOOP = () => {}
const SIDEBAR_TOP_CLASS = 'flex shrink-0 items-center gap-1 bg-navigation text-sm'
type WorkspaceShellSidebarChromeRegion = 'drag' | 'none'

interface WorkspaceLayoutSidebarProps {
  workspaceId?: WorkspaceId
  git: GitWorkspaceClientState | null
  compact: boolean
  branchContent?: VNodeChild
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

export const WorkspaceLayoutSidebar = defineComponent<WorkspaceLayoutSidebarProps>({
  name: 'WorkspaceLayoutSidebar',
  props: [
    'workspaceId',
    'git',
    'compact',
    'branchContent',
    'chromeRegion',
    'onOpenSettings',
    'onSelectBranch',
    'onCreateWorktree',
    'onOpenDashboard',
    'dashboardSelected',
    'newWorktreeSelected',
    'currentBranchName',
    'workspaceRootSelected',
    'onSelectWorkspaceRoot',
  ],

  setup(props) {
    const t = useT()

    return () => {
      const navigatorTitleKey = props.git ? 'tab.branches' : 'workspace.navigation-title'
      const backgroundClass = props.compact ? 'bg-background' : 'bg-navigation'
      return (
        <aside class={cn('flex min-h-0 min-w-0 flex-1 flex-col', backgroundClass)}>
          {!props.compact && props.chromeRegion !== 'none' ? (
            <TitleBarDragRegion
              class={SIDEBAR_TOP_CLASS}
              data-testid="workspace-shell-sidebar-top"
              style={{ height: `${TITLE_BAR_HEIGHT_PX}px` }}
            />
          ) : !props.compact ? (
            <div
              class={SIDEBAR_TOP_CLASS}
              data-testid="workspace-shell-sidebar-top"
              style={{ height: `${TITLE_BAR_HEIGHT_PX}px` }}
            />
          ) : null}
          <WorkspaceShellPrimaryActions
            workspaceId={props.workspaceId}
            onCreateWorktree={props.onCreateWorktree}
            onOpenDashboard={props.onOpenDashboard}
            dashboardSelected={props.dashboardSelected}
            newWorktreeSelected={props.newWorktreeSelected}
            gitAvailable={props.git !== null}
          />
          {props.workspaceId ? (
            <>
              <WorkspaceShellNavigatorHeader
                workspaceId={props.workspaceId}
                title={t(navigatorTitleKey)}
                gitAvailable={props.git !== null}
              />
              <div class={cn('flex min-h-0 flex-1', backgroundClass)}>
                {props.branchContent ??
                  (props.git ? (
                    <BranchNavigator
                      repoId={props.workspaceId}
                      onSelectBranch={props.onSelectBranch}
                      currentBranchName={props.currentBranchName}
                    />
                  ) : (
                    <WorkspaceRootNavigator
                      workspaceId={props.workspaceId}
                      selected={props.workspaceRootSelected ?? false}
                      onSelect={props.onSelectWorkspaceRoot}
                    />
                  ))}
              </div>
            </>
          ) : (
            <div class={cn('flex min-h-0 flex-1', backgroundClass)} />
          )}
          <SidebarSettingsButton backgroundClass={backgroundClass} onOpenSettings={props.onOpenSettings} />
        </aside>
      )
    }
  },
})

interface WorkspaceShellPrimaryActionsProps {
  workspaceId?: WorkspaceId
  onCreateWorktree?: () => void
  onOpenDashboard?: () => void
  dashboardSelected?: boolean
  newWorktreeSelected?: boolean
  gitAvailable: boolean
}

const WorkspaceShellPrimaryActions: FunctionalComponent<WorkspaceShellPrimaryActionsProps> = (props) => (
  <div class="shrink-0 px-3 pt-4">
    <div class="flex min-w-0 flex-col gap-1">
      <WorkspacePickerRow workspaceId={props.workspaceId} />
      {props.workspaceId ? (
        <>
          <WorkspaceDashboardRowAction selected={props.dashboardSelected} onOpenDashboard={props.onOpenDashboard} />
          {props.gitAvailable ? (
            <CreateWorktreeRowAction
              repoId={props.workspaceId}
              selected={props.newWorktreeSelected}
              onCreateWorktree={props.onCreateWorktree}
            />
          ) : null}
        </>
      ) : null}
    </div>
  </div>
)

WorkspaceShellPrimaryActions.props = [
  'workspaceId',
  'onCreateWorktree',
  'onOpenDashboard',
  'dashboardSelected',
  'newWorktreeSelected',
  'gitAvailable',
]

const WorkspacePickerRow = defineComponent<{ workspaceId?: WorkspaceId }>({
  name: 'WorkspacePickerRow',
  props: ['workspaceId'],
  setup(props) {
    const overlayActions = useLayoutOverlayActions()
    return () => (
      <div class="flex h-8 min-w-0 shrink-0 items-center">
        <WorkspacePickerHost
          currentWorkspaceId={props.workspaceId ?? null}
          onOpenWorkspacePathDialog={overlayActions?.openWorkspacePathDialog ?? NOOP}
          onOpenRemote={overlayActions?.openRemoteWorkspace ?? NOOP}
          onClone={overlayActions?.openCloneRepo ?? NOOP}
          surface="sidebar"
        />
      </div>
    )
  },
})

interface WorkspaceShellNavigatorHeaderProps {
  workspaceId: WorkspaceId
  title: string
  gitAvailable: boolean
}

const WorkspaceShellNavigatorHeader: FunctionalComponent<WorkspaceShellNavigatorHeaderProps> = (props) => (
  <div class="shrink-0 px-3 pb-2 pt-3">
    <div class="flex h-8 min-w-0 items-center gap-2 px-3">
      <div class="min-w-0 flex-1 truncate text-[13px] font-semibold text-muted-foreground">{props.title}</div>
      {props.gitAvailable ? <BranchFilterAction repoId={props.workspaceId} /> : null}
      {props.gitAvailable ? (
        <RepoSyncAction repoId={props.workspaceId} />
      ) : (
        <WorkspaceRefreshAction workspaceId={props.workspaceId} />
      )}
    </div>
  </div>
)

WorkspaceShellNavigatorHeader.props = ['workspaceId', 'title', 'gitAvailable']

const SidebarSettingsButton = defineComponent<{ backgroundClass: string; onOpenSettings?: () => void }>({
  name: 'SidebarSettingsButton',
  props: ['backgroundClass', 'onOpenSettings'],
  setup(props) {
    const t = useT()
    return () => (
      <div class={cn('relative z-10 shrink-0 p-2', props.backgroundClass)}>
        <SidebarRowButton
          aria-label={t('app-chrome.settings')}
          onClick={() => props.onOpenSettings?.()}
          leading={<Settings size={16} />}
        >
          {t('app-chrome.settings-tooltip')}
        </SidebarRowButton>
      </div>
    )
  },
})
