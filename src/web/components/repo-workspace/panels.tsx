import { FolderTree } from '@lucide/vue'
import { defineComponent } from 'vue'
import type { FunctionalComponent, VNodeChild } from 'vue'
import type { RepoLogTarget } from '#/shared/git-types.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import { EmptyState, ScrollPane } from '#/web/components/Layout.tsx'
import { StatusList } from '#/web/components/StatusList.tsx'
import { BranchStatus } from '#/web/components/repo-workspace/BranchStatus.tsx'
import { GitHistoryPanel } from '#/web/components/repo-workspace/GitHistoryPanel.tsx'
import { WorkspaceFilesystemTabPanel } from '#/web/components/workspace-pane/WorkspaceFilesystemTabPanel.tsx'
import type {
  CurrentGitWorkspacePanePresentation,
  GitWorkspacePaneProjection,
} from '#/web/components/repo-workspace/model.ts'
import type { WorkspacePaneStaticTabType, WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import { isWorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import type {
  WorkspacePaneRuntimeTabStateByType,
  WorkspacePaneSelection,
} from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import type { WorkspacePanePanelLabel } from '#/web/workspace-pane/tab-providers.ts'
import { WorkspacePanePanelFrame } from '#/web/components/workspace-pane/WorkspacePanePanelFrame.tsx'
import { renderWorkspacePaneRuntimeTabPanel } from '#/web/workspace-pane/workspace-pane-runtime-tab-panel.tsx'
import { gitWorktreeWorkspacePaneTabsTarget, runtimeWorkspacePaneTarget } from '#/shared/workspace-pane-tabs-target.ts'
import { terminalGitWorktreePresentation } from '#/shared/terminal-types.ts'
import { gitHead } from '#/shared/git-head.ts'
import { gitWorktreePaneFilesystemTarget } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'

export interface WorkspacePanePanelRenderInput {
  type: WorkspacePaneTabType
  repo: Pick<GitWorkspacePaneProjection, 'id' | 'workspaceRuntimeId' | 'snapshot' | 'status' | 'ui' | 'probe'>
  detail: CurrentGitWorkspacePanePresentation
  workspacePaneId: string
  panelLabel: WorkspacePanePanelLabel
  selection: WorkspacePaneSelection
  runtimeTabStateByType: WorkspacePaneRuntimeTabStateByType
}

type WorkspacePanePanelProps = Pick<WorkspacePanePanelRenderInput, 'repo' | 'detail' | 'workspacePaneId' | 'panelLabel'>

type GitWorkspacePaneBranch = NonNullable<CurrentGitWorkspacePanePresentation['branch']>
type WorkspacePaneStaticPanelComponent = FunctionalComponent<WorkspacePanePanelProps>

const REPO_WORKSPACE_STATIC_PANEL_BY_TYPE: Record<WorkspacePaneStaticTabType, WorkspacePaneStaticPanelComponent> = {
  status: StatusWorkspacePanePanel,
  changes: ChangesWorkspacePanePanel,
  history: HistoryWorkspacePanePanel,
  files: FilesWorkspacePanePanel,
}

export function renderGitWorkspacePanePanel(input: WorkspacePanePanelRenderInput): VNodeChild {
  if (isWorkspacePaneRuntimeTabType(input.type)) {
    const runtimeState = input.runtimeTabStateByType[input.type]
    const worktree = input.detail.worktree
    if (!worktree) return null
    const worktreePath = worktree.path
    const tabsTarget = gitWorktreeWorkspacePaneTabsTarget(input.repo.id, worktreePath)
    if (!tabsTarget) return null
    const runtimeTarget = runtimeWorkspacePaneTarget(tabsTarget, input.repo.workspaceRuntimeId)
    if (!runtimeTarget) return null
    return renderWorkspacePaneRuntimeTabPanel({
      type: input.type,
      workspacePaneId: input.workspacePaneId,
      panelLabel: input.panelLabel,
      selectedSessionId: selectedRuntimeSessionId(input.selection, input.type),
      target: {
        runtimeTarget,
        presentation: terminalGitWorktreePresentation(),
      },
      runtimeState: {
        projectionPhase: runtimeState.projectionPhase,
        projectionErrorMessage: runtimeState.projectionErrorMessage,
      },
    })
  }
  const Panel = REPO_WORKSPACE_STATIC_PANEL_BY_TYPE[input.type]
  return (
    <Panel
      repo={input.repo}
      detail={input.detail}
      workspacePaneId={input.workspacePaneId}
      panelLabel={input.panelLabel}
    />
  )
}

function selectedRuntimeSessionId(selection: WorkspacePaneSelection, type: WorkspacePaneTabType): string | null {
  if (selection.kind !== 'materialized-tab') return null
  const tab = selection.materializedTab
  return tab.kind === 'runtime' && tab.runtimeType === type ? tab.sessionId : null
}

function StatusWorkspacePanePanel({ repo, workspacePaneId, panelLabel, detail }: WorkspacePanePanelProps) {
  return (
    <WorkspacePanePanelFrame
      id={`${workspacePaneId}-status-panel`}
      {...panelLabel}
      busy={detail.loading.pullRequests || detail.loading.status}
    >
      <ScrollPane>
        <BranchStatus detail={detail} workspaceRuntimeId={repo.workspaceRuntimeId} />
      </ScrollPane>
    </WorkspacePanePanelFrame>
  )
}

function HistoryWorkspacePanePanel({ repo, detail, workspacePaneId, panelLabel }: WorkspacePanePanelProps) {
  const branch = detail.branch
  if (!branch) return null
  const worktree = detail.worktree
  const target: RepoLogTarget = worktree
    ? { kind: 'commit', oid: requiredCommittedHeadOid(worktree.headOid) }
    : { kind: 'branch', branchName: branch.name }
  return (
    <GitHistoryPanel
      repoId={repo.id}
      workspaceRuntimeId={repo.workspaceRuntimeId}
      target={target}
      workspacePaneId={workspacePaneId}
      panelLabel={panelLabel}
    />
  )
}

function requiredCommittedHeadOid(headOid: string | null): string {
  if (headOid === null) throw new Error('A branch workspace pane requires a committed worktree HEAD')
  return headOid
}

function ChangesWorkspacePanePanel({ detail, workspacePaneId, panelLabel }: WorkspacePanePanelProps) {
  const branch = detail.branch
  if (!branch) return null
  return (
    <BranchChangesTab
      workspacePaneId={workspacePaneId}
      panelLabel={panelLabel}
      branch={branch}
      hasWorktree={!!detail.worktree}
      currentBranchStatus={detail.currentBranchStatus}
      statusLoading={detail.loading.status}
    />
  )
}

function FilesWorkspacePanePanel({ repo, detail, workspacePaneId, panelLabel }: WorkspacePanePanelProps) {
  const branch = detail.branch
  const worktreePath = detail.worktree?.path
  const capabilities = repo.probe.capabilities
  if (!branch || !worktreePath || !capabilities) {
    return (
      <WorkspacePanePanelFrame id={`${workspacePaneId}-files-panel`} {...panelLabel}>
        <FiletreeNoWorktreeView />
      </WorkspacePanePanelFrame>
    )
  }
  return (
    <WorkspacePanePanelFrame id={`${workspacePaneId}-files-panel`} {...panelLabel}>
      <WorkspaceFilesystemTabPanel
        target={gitWorktreePaneFilesystemTarget({
          workspaceId: repo.id,
          workspaceRuntimeId: repo.workspaceRuntimeId,
          worktreePath,
          head: gitHead(branch.name),
          capabilities,
        })}
      />
    </WorkspacePanePanelFrame>
  )
}

const FiletreeNoWorktreeView = defineComponent({
  name: 'FiletreeNoWorktreeView',
  setup() {
    const t = useT()
    return () => (
      <EmptyState
        icon={<FolderTree size={16} />}
        title={t('filetree.no-worktree-title')}
        body={t('filetree.no-worktree-body')}
      />
    )
  },
})

interface BranchChangesTabProps {
  workspacePaneId: string
  panelLabel: WorkspacePanePanelLabel
  branch: GitWorkspacePaneBranch
  hasWorktree: boolean
  currentBranchStatus: CurrentGitWorkspacePanePresentation['currentBranchStatus']
  statusLoading: boolean
}

const BranchChangesTab = defineComponent<BranchChangesTabProps>({
  name: 'BranchChangesTab',
  props: ['workspacePaneId', 'panelLabel', 'branch', 'hasWorktree', 'currentBranchStatus', 'statusLoading'],

  setup(props) {
    const t = useT()
    return () => {
      const totalEntries = props.currentBranchStatus?.reduce((count, worktree) => count + worktree.entries.length, 0)
      const unavailableStatusKey = props.statusLoading ? 'dashboard.loading' : 'error.failed-read-repo'
      return (
        <WorkspacePanePanelFrame
          id={`${props.workspacePaneId}-changes-panel`}
          {...props.panelLabel}
          busy={props.statusLoading}
        >
          {props.hasWorktree ? (
            <div class="relative flex min-h-0 flex-1 flex-col">
              {props.currentBranchStatus === undefined ? (
                <EmptyState title={t(unavailableStatusKey)} />
              ) : totalEntries && totalEntries > 0 ? (
                <ScrollPane>
                  <StatusList status={props.currentBranchStatus} />
                </ScrollPane>
              ) : (
                <StatusList status={props.currentBranchStatus} />
              )}
            </div>
          ) : (
            <EmptyState
              icon={<FolderTree size={16} />}
              title={t('status.no-worktree-title')}
              body={t('status.no-worktree-body')}
            />
          )}
        </WorkspacePanePanelFrame>
      )
    }
  },
})
