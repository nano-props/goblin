import { Settings } from '@lucide/vue'
import { defineComponent } from 'vue'
import type { FunctionalComponent, VNodeChild } from 'vue'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { WORKSPACE_TOOLBAR_HEIGHT_PX } from '#/web/components/workspace-toolbar-layout.ts'
import { GitWorkspaceNavigatorView } from '#/web/components/workspace-navigator/GitWorkspaceNavigatorView.tsx'
import { WorkspacePickerHost } from '#/web/components/WorkspacePickerHost.tsx'
import { NavigatorSectionHeader } from '#/web/components/workspace-navigator/NavigatorSectionHeader.tsx'
import { WorkspaceRootNavigator } from '#/web/components/workspace-navigator/WorkspaceRootNavigator.tsx'
import {
  BranchFilterAction,
  CreateWorktreeRowAction,
  RepoSyncAction,
} from '#/web/components/repo-toolbar/RepoToolbarActions.tsx'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { Separator } from '#/web/components/ui/separator.tsx'
import { SidebarRowButton } from '#/web/components/ui/sidebar-row-button.tsx'
import { WorkspaceDashboardRowAction } from '#/web/components/workspace-layout/WorkspaceDashboardRowAction.tsx'
import { WorkspaceRefreshAction } from '#/web/components/workspace-toolbar/WorkspaceRefreshAction.tsx'
import { useLayoutOverlayActions } from '#/web/app/layout-overlay-actions-context.ts'
import { cn } from '#/web/lib/cn.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import type { GitWorkspaceClientState } from '#/web/stores/workspaces/types.ts'

const NOOP = () => {}
const SIDEBAR_TOP_CLASS = 'flex shrink-0 items-center gap-1 bg-navigation text-sm'

interface WorkspaceLayoutSidebarProps {
  workspaceId?: WorkspaceId
  git: GitWorkspaceClientState | null
  compact: boolean
  navigatorContent?: VNodeChild
  onOpenSettings?: () => void
  onSelectBranch?: (branch: string) => void
  onCreateWorktree?: () => void
  onOpenDashboard?: () => void
  dashboardSelected?: boolean
  newWorktreeSelected?: boolean
  currentBranchName?: string | null
  currentWorktreePath?: string | null
  workspaceRootSelected?: boolean
  onSelectWorkspaceRoot?: () => void
}

export const WorkspaceLayoutSidebar = defineComponent<WorkspaceLayoutSidebarProps>({
  name: 'WorkspaceLayoutSidebar',
  props: [
    'workspaceId',
    'git',
    'compact',
    'navigatorContent',
    'onOpenSettings',
    'onSelectBranch',
    'onCreateWorktree',
    'onOpenDashboard',
    'dashboardSelected',
    'newWorktreeSelected',
    'currentBranchName',
    'currentWorktreePath',
    'workspaceRootSelected',
    'onSelectWorkspaceRoot',
  ],

  setup(props) {
    const t = useT()

    return () => {
      const navigatorTitleKey = props.git ? 'tab.branches' : 'workspace.directory-title'
      const backgroundClass = props.compact ? 'bg-background' : 'bg-navigation'
      return (
        <aside class={cn('flex min-h-0 min-w-0 flex-1 flex-col', backgroundClass)}>
          {!props.compact ? (
            <div
              class={SIDEBAR_TOP_CLASS}
              data-testid="workspace-shell-sidebar-top"
              style={{ height: `${WORKSPACE_TOOLBAR_HEIGHT_PX}px` }}
            />
          ) : null}
          <ScrollArea class="min-h-0 flex-1">
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
                {props.navigatorContent ??
                  (props.git ? (
                    <GitWorkspaceNavigatorView
                      repoId={props.workspaceId}
                      onSelectBranch={props.onSelectBranch}
                      currentBranchName={props.currentBranchName}
                      currentWorktreePath={props.currentWorktreePath}
                    />
                  ) : (
                    <WorkspaceRootNavigator
                      workspaceId={props.workspaceId}
                      selected={props.workspaceRootSelected ?? false}
                      onSelect={props.onSelectWorkspaceRoot}
                    />
                  ))}
              </>
            ) : null}
          </ScrollArea>
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
  <div class="shrink-0 pt-4">
    <SidebarWorkspacePicker workspaceId={props.workspaceId} />
    {props.workspaceId ? (
      <div class="flex min-w-0 flex-col gap-1 px-3">
        <Separator class="my-2 dark:bg-border" />
        <WorkspaceDashboardRowAction selected={props.dashboardSelected} onOpenDashboard={props.onOpenDashboard} />
        {props.gitAvailable ? (
          <CreateWorktreeRowAction
            repoId={props.workspaceId}
            selected={props.newWorktreeSelected}
            onCreateWorktree={props.onCreateWorktree}
          />
        ) : null}
      </div>
    ) : null}
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

const SidebarWorkspacePicker = defineComponent<{ workspaceId?: WorkspaceId }>({
  name: 'SidebarWorkspacePicker',
  props: ['workspaceId'],
  setup(props) {
    const overlayActions = useLayoutOverlayActions()
    return () => (
      <WorkspacePickerHost
        currentWorkspaceId={props.workspaceId ?? null}
        onOpenWorkspacePathDialog={overlayActions?.openWorkspacePathDialog ?? NOOP}
        onOpenRemote={overlayActions?.openRemoteWorkspace ?? NOOP}
        onClone={overlayActions?.openCloneRepo ?? NOOP}
      />
    )
  },
})

interface WorkspaceShellNavigatorHeaderProps {
  workspaceId: WorkspaceId
  title: string
  gitAvailable: boolean
}

const WorkspaceShellNavigatorHeader: FunctionalComponent<WorkspaceShellNavigatorHeaderProps> = (props) => (
  <NavigatorSectionHeader title={props.title} class="pt-3">
    {props.gitAvailable ? <BranchFilterAction repoId={props.workspaceId} /> : null}
    {props.gitAvailable ? (
      <RepoSyncAction repoId={props.workspaceId} />
    ) : (
      <WorkspaceRefreshAction workspaceId={props.workspaceId} />
    )}
  </NavigatorSectionHeader>
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
