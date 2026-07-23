import { FolderTree } from 'lucide-react'
import type { ReactNode } from 'react'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { useT } from '#/web/stores/i18n.ts'
import { EmptyState, ScrollPane } from '#/web/components/Layout.tsx'
import { StatusList } from '#/web/components/StatusList.tsx'
import { useRepoLogQuery } from '#/web/repo-queries.ts'
import { BranchStatus } from '#/web/components/repo-workspace/BranchStatus.tsx'
import { WorkspaceFilesystemTabPanel } from '#/web/components/workspace-pane/WorkspaceFilesystemTabPanel.tsx'
import type {
  CurrentGitWorkspacePanePresentation,
  GitWorkspacePaneProjection,
} from '#/web/components/repo-workspace/model.ts'
import { DEFAULT_REPOSITORY_LOG_COUNT } from '#/shared/git-types.ts'
import type { WorkspacePaneStaticTabType, WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import { isWorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import type {
  WorkspacePaneRuntimeTabStateByType,
  WorkspacePaneSelection,
} from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import type { WorkspacePanePanelLabel } from '#/web/workspace-pane/tab-providers.ts'
import { WorkspacePanePanelFrame } from '#/web/components/workspace-pane/WorkspacePanePanelFrame.tsx'
import { HistoryCommitGraph, HistoryCommitGraphSkeleton } from '#/web/components/repo-workspace/HistoryCommitGraph.tsx'
import { renderWorkspacePaneRuntimeTabPanel } from '#/web/workspace-pane/workspace-pane-runtime-tab-panel.tsx'
import { gitWorktreeWorkspacePaneTabsTarget, runtimeWorkspacePaneTarget } from '#/shared/workspace-pane-tabs-target.ts'
import { terminalGitWorktreePresentation } from '#/shared/terminal-types.ts'
import { gitHead } from '#/shared/git-head.ts'
import { gitWorktreePaneFilesystemTarget } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'

const DEFAULT_BRANCH_HISTORY_ERROR_KEY = 'error.failed-read-repo'

export interface WorkspacePanePanelRenderInput {
  type: WorkspacePaneTabType
  repo: Pick<GitWorkspacePaneProjection, 'id' | 'workspaceRuntimeId' | 'branchModel' | 'ui' | 'probe'> & {
    branchModel: GitWorkspacePaneProjection['branchModel']
  }
  detail: CurrentGitWorkspacePanePresentation
  workspacePaneId: string
  panelLabel: WorkspacePanePanelLabel
  selection: WorkspacePaneSelection
  runtimeTabStateByType: WorkspacePaneRuntimeTabStateByType
}

interface WorkspacePanePanelProps extends Omit<WorkspacePanePanelRenderInput, 'type' | 'selection'> {}

type GitWorkspacePaneBranch = NonNullable<CurrentGitWorkspacePanePresentation['branch']>
type WorkspacePaneStaticPanelComponent = (props: WorkspacePanePanelProps) => ReactNode

const REPO_WORKSPACE_STATIC_PANEL_BY_TYPE: Record<WorkspacePaneStaticTabType, WorkspacePaneStaticPanelComponent> = {
  status: StatusWorkspacePanePanel,
  changes: ChangesWorkspacePanePanel,
  history: HistoryWorkspacePanePanel,
  files: FilesWorkspacePanePanel,
}

export function renderGitWorkspacePanePanel(input: WorkspacePanePanelRenderInput): ReactNode {
  const { type, selection, ...panelProps } = input
  if (isWorkspacePaneRuntimeTabType(type)) {
    const runtimeState = input.runtimeTabStateByType[type]
    const branch = input.detail.branch
    if (!branch?.worktree?.path) return null
    const branchName = branch.name
    const worktreePath = branch.worktree.path
    const tabsTarget = gitWorktreeWorkspacePaneTabsTarget(input.repo.id, worktreePath)
    const runtimeTarget = tabsTarget ? runtimeWorkspacePaneTarget(tabsTarget, input.repo.workspaceRuntimeId) : null
    if (!runtimeTarget || !worktreePath) return null
    return renderWorkspacePaneRuntimeTabPanel({
      type,
      workspacePaneId: input.workspacePaneId,
      panelLabel: input.panelLabel,
      selectedSessionId: selectedRuntimeSessionId(selection, type),
      target: {
        routeTarget: { kind: 'git-branch', workspaceId: input.repo.id, branchName },
        runtimeTarget,
        presentation: terminalGitWorktreePresentation(branchName),
      },
      runtimeState: {
        projectionPhase: runtimeState.projectionPhase,
        projectionErrorMessage: runtimeState.projectionErrorMessage,
      },
    })
  }
  const Panel = REPO_WORKSPACE_STATIC_PANEL_BY_TYPE[type]
  return <Panel {...panelProps} />
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
  return (
    <BranchHistoryTab
      repoId={repo.id}
      workspaceRuntimeId={repo.workspaceRuntimeId}
      branchName={branch.name}
      workspacePaneId={workspacePaneId}
      panelLabel={panelLabel}
    />
  )
}

function ChangesWorkspacePanePanel({ detail, workspacePaneId, panelLabel }: WorkspacePanePanelProps) {
  const branch = detail.branch
  if (!branch) return null
  return (
    <BranchChangesTab
      workspacePaneId={workspacePaneId}
      panelLabel={panelLabel}
      branch={branch}
      currentBranchStatus={detail.currentBranchStatus}
      statusLoading={detail.loading.status}
    />
  )
}

function FilesWorkspacePanePanel({ repo, detail, workspacePaneId, panelLabel }: WorkspacePanePanelProps) {
  const branch = detail.branch
  const worktreePath = branch?.worktree?.path
  const capabilities = repo.probe.capabilities
  if (!worktreePath || !capabilities) {
    return (
      <WorkspacePanePanelFrame id={`${workspacePaneId}-files-panel`} {...panelLabel}>
        <FiletreeNoWorktreeView />
      </WorkspacePanePanelFrame>
    )
  }
  return (
    <WorkspacePanePanelFrame id={`${workspacePaneId}-files-panel`} {...panelLabel}>
      <WorkspaceFilesystemTabPanel
        routeTarget={{ kind: 'git-branch', workspaceId: repo.id, branchName: branch.name }}
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

function FiletreeNoWorktreeView() {
  const t = useT()
  return (
    <EmptyState
      icon={<FolderTree size={16} />}
      title={t('filetree.no-worktree-title')}
      body={t('filetree.no-worktree-body')}
    />
  )
}

function BranchHistoryTab({
  repoId,
  workspaceRuntimeId,
  branchName,
  workspacePaneId,
  panelLabel,
}: {
  repoId: WorkspaceId
  workspaceRuntimeId: string
  branchName: string
  workspacePaneId: string
  panelLabel: WorkspacePanePanelLabel
}) {
  const t = useT()
  const historyQuery = useRepoLogQuery(repoId, workspaceRuntimeId, branchName, {
    count: DEFAULT_REPOSITORY_LOG_COUNT,
  })
  const entries = historyQuery.data ?? []
  const errorTitleKey =
    historyQuery.error instanceof Error ? historyQuery.error.message : DEFAULT_BRANCH_HISTORY_ERROR_KEY

  return (
    <WorkspacePanePanelFrame id={`${workspacePaneId}-history-panel`} {...panelLabel} busy={historyQuery.isLoading}>
      {historyQuery.isLoading ? (
        <HistoryCommitGraphSkeleton rows={8} />
      ) : historyQuery.isError ? (
        <EmptyState title={t(errorTitleKey)} />
      ) : entries.length === 0 ? (
        <EmptyState title={t('log.empty-for-branch', { branch: branchName })} />
      ) : (
        <ScrollPane>
          <HistoryCommitGraph repoId={repoId} workspaceRuntimeId={workspaceRuntimeId} entries={entries} />
        </ScrollPane>
      )}
    </WorkspacePanePanelFrame>
  )
}

function BranchChangesTab({
  workspacePaneId,
  panelLabel,
  branch,
  currentBranchStatus,
  statusLoading,
}: {
  workspacePaneId: string
  panelLabel: WorkspacePanePanelLabel
  branch: GitWorkspacePaneBranch
  currentBranchStatus: CurrentGitWorkspacePanePresentation['currentBranchStatus']
  statusLoading: boolean
}) {
  const t = useT()
  const totalEntries = currentBranchStatus.reduce((n, wt) => n + wt.entries.length, 0)

  return (
    <WorkspacePanePanelFrame id={`${workspacePaneId}-changes-panel`} {...panelLabel} busy={statusLoading}>
      {branch.worktree?.path ? (
        <div className="relative flex min-h-0 flex-1 flex-col">
          {totalEntries > 0 ? (
            <ScrollPane>
              <StatusList status={currentBranchStatus} />
            </ScrollPane>
          ) : (
            <StatusList status={currentBranchStatus} />
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
