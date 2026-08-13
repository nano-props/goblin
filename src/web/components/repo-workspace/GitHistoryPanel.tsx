import { defineComponent } from 'vue'
import { DEFAULT_REPOSITORY_LOG_COUNT } from '#/shared/git-types.ts'
import type { RepoLogTarget } from '#/shared/git-types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { EmptyState, ScrollPane } from '#/web/components/Layout.tsx'
import { HistoryCommitGraph, HistoryCommitGraphSkeleton } from '#/web/components/repo-workspace/HistoryCommitGraph.tsx'
import { WorkspacePanePanelFrame } from '#/web/components/workspace-pane/WorkspacePanePanelFrame.tsx'
import type { WorkspacePanePanelLabel } from '#/web/workspace-pane/tab-providers.ts'
import { useRepoLogQuery } from '#/web/repo-queries.ts'
import { useT } from '#/web/stores/i18n-vue.ts'

interface GitHistoryPanelProps {
  repoId: WorkspaceId
  workspaceRuntimeId: string
  target: RepoLogTarget
  workspacePaneId: string
  panelLabel: WorkspacePanePanelLabel
}

interface EmptyGitHistoryPanelProps {
  workspacePaneId: string
  panelLabel: WorkspacePanePanelLabel
}

export const EmptyGitHistoryPanel = defineComponent<EmptyGitHistoryPanelProps>({
  name: 'EmptyGitHistoryPanel',
  props: ['workspacePaneId', 'panelLabel'],
  setup(props) {
    const t = useT()
    return () => (
      <WorkspacePanePanelFrame id={`${props.workspacePaneId}-history-panel`} {...props.panelLabel}>
        <EmptyState title={t('log.empty')} />
      </WorkspacePanePanelFrame>
    )
  },
})

export const GitHistoryPanel = defineComponent<GitHistoryPanelProps>({
  name: 'GitHistoryPanel',
  props: ['repoId', 'workspaceRuntimeId', 'target', 'workspacePaneId', 'panelLabel'],

  setup(props) {
    const t = useT()
    const historyQuery = useRepoLogQuery(
      () => props.repoId,
      () => props.workspaceRuntimeId,
      () => props.target,
      { count: DEFAULT_REPOSITORY_LOG_COUNT },
    )

    return () => {
      const entries = historyQuery.data.value ?? []
      const queryError = historyQuery.error.value
      const errorTitleKey = queryError instanceof Error ? queryError.message : 'error.failed-read-repo'
      const emptyTitle =
        props.target.kind === 'branch' ? t('log.empty-for-branch', { branch: props.target.branchName }) : t('log.empty')
      return (
        <WorkspacePanePanelFrame
          id={`${props.workspacePaneId}-history-panel`}
          {...props.panelLabel}
          busy={historyQuery.isLoading.value}
        >
          {historyQuery.isLoading.value ? (
            <HistoryCommitGraphSkeleton rows={8} />
          ) : historyQuery.isError.value ? (
            <EmptyState title={t(errorTitleKey)} />
          ) : entries.length === 0 ? (
            <EmptyState title={emptyTitle} />
          ) : (
            <ScrollPane>
              <HistoryCommitGraph
                repoId={props.repoId}
                workspaceRuntimeId={props.workspaceRuntimeId}
                entries={entries}
              />
            </ScrollPane>
          )}
        </WorkspacePanePanelFrame>
      )
    }
  },
})
