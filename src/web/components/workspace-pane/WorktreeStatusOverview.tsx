import { Diff, FolderTree, GitBranch, GitCommitHorizontal, GitMerge } from '@lucide/vue'
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import type { RepoWorktreeSnapshot, WorktreeStatus } from '#/shared/git-types.ts'
import {
  ClickableStatusChip,
  CopyableValue,
  StatusLink,
  StatusChip,
  StatusRow,
  StatusRows,
} from '#/web/components/workspace-pane/status-ui.tsx'
import { useT } from '#/web/stores/i18n-vue.ts'
import { worktreeOperationKey } from '#/web/worktree-presentation.ts'

interface WorktreeStatusOverviewProps {
  worktree: RepoWorktreeSnapshot
  status?: WorktreeStatus
  statusPending: boolean
  statusUnavailable: boolean
  onOpenChanges: () => void
  onOpenHistory: () => void
}

export const WorktreeStatusOverview = defineComponent<WorktreeStatusOverviewProps>({
  name: 'WorktreeStatusOverview',
  props: {
    worktree: { type: Object as PropType<RepoWorktreeSnapshot>, required: true },
    status: Object as PropType<WorktreeStatus>,
    statusPending: { type: Boolean, required: true },
    statusUnavailable: { type: Boolean, required: true },
    onOpenChanges: { type: Function as PropType<() => void>, required: true },
    onOpenHistory: { type: Function as PropType<() => void>, required: true },
  },

  setup(props) {
    const t = useT()

    return () => {
      const { worktree } = props
      const changeCount = props.status?.entries.length
      const operation = worktree.operation
      const shortHeadOid = worktree.headOid?.slice(0, 12) ?? null
      const openHistoryLabel = shortHeadOid ? t('worktree-status.open-history', { commit: shortHeadOid }) : null
      return (
        <StatusRows>
          {shortHeadOid && openHistoryLabel ? (
            <StatusRow
              icon={<GitCommitHorizontal size={14} />}
              label={t('branch-status.signal.commit')}
              value={
                <StatusLink mono aria-label={openHistoryLabel} title={openHistoryLabel} onClick={props.onOpenHistory}>
                  {shortHeadOid}
                </StatusLink>
              }
              valueLayout="inline"
            />
          ) : null}
          {worktree.materializedBranch ? (
            <StatusRow
              icon={<GitBranch size={14} />}
              label={t('branch-status.signal.branch')}
              value={
                <CopyableValue
                  value={worktree.materializedBranch}
                  copyLabel={t('branch-status.copy-branch-name')}
                  copiedLabel={t('branch-status.copied')}
                />
              }
              valueLayout="inline"
              tone="brand"
            />
          ) : null}
          {operation ? (
            <StatusRow
              icon={<GitMerge size={14} />}
              label={t('worktree-status.signal.operation')}
              value={<StatusChip tone="attention">{t(worktreeOperationKey(operation))}</StatusChip>}
              valueLayout="inline"
              tone="attention"
            />
          ) : null}
          <StatusRow
            icon={<FolderTree size={14} />}
            label={t('branch-status.signal.worktree')}
            value={
              <CopyableValue
                value={worktree.path}
                copyLabel={t('branch-status.copy-worktree-path')}
                copiedLabel={t('branch-status.copied')}
              />
            }
            after={
              <>
                <StatusChip>{t(worktree.isPrimary ? 'worktree-status.primary' : 'worktree-status.linked')}</StatusChip>
                {worktree.isLocked ? (
                  <StatusChip tone="attention">{t('branch-status.worktree.locked')}</StatusChip>
                ) : null}
              </>
            }
            valueLayout="inline"
            tone={worktree.isLocked ? 'attention' : 'brand'}
          />
          <StatusRow
            icon={<Diff size={14} />}
            label={t('branch-status.signal.changes')}
            value={
              changeCount !== undefined ? (
                <ClickableStatusChip
                  tone={changeCount > 0 ? 'attention' : 'success'}
                  title={t('workspace-pane-tabs.changes-tooltip', { count: changeCount })}
                  onClick={props.onOpenChanges}
                >
                  {t('branch-status.changes-count', { n: changeCount })}
                </ClickableStatusChip>
              ) : (
                <StatusChip tone={props.statusUnavailable ? 'attention' : 'neutral'}>
                  {t(props.statusPending ? 'worktree-status.changes-loading' : 'worktree-status.changes-unavailable')}
                </StatusChip>
              )
            }
            valueLayout="inline"
            tone={changeCount !== undefined && changeCount > 0 ? 'attention' : 'neutral'}
          />
        </StatusRows>
      )
    }
  },
})
