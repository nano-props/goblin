import { defineComponent, onScopeDispose } from 'vue'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import {
  ArrowDown,
  ArrowUp,
  Check,
  Diff,
  FolderTree,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  RadioTower,
  RefreshCw,
} from '@lucide/vue'
import { throttle } from 'es-toolkit'
import { i18nStore } from '#/web/stores/i18n.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import { EmptyState } from '#/web/components/Layout.tsx'
import { PullRequestStatusRow } from '#/web/components/repo-workspace/PullRequestStatusRow.tsx'
import { IconCopyButton } from '#/web/components/IconCopyButton.tsx'
import { CopyButton } from '#/web/components/CopyButton.tsx'
import { BranchActionsPopover } from '#/web/components/BranchActionsMenu.tsx'
import type { BranchActionItem } from '#/web/hooks/useBranchActionItems.tsx'
import type { BranchCopyPatchAction } from '#/web/hooks/branch-action-state.ts'
import { useActionFeedback } from '#/web/hooks/useActionFeedback.ts'
import { useBranchActionSurface } from '#/web/components/repo-workspace/branch-action-surface-context.ts'
import {
  ClickableStatusChip,
  CopyableValue,
  StatusChip,
  StatusLink,
  StatusRow,
  StatusRows,
} from '#/web/components/workspace-pane/status-ui.tsx'
import type { Tone } from '#/web/components/workspace-pane/status-ui.tsx'
import { formatRelativeTimeOrNull } from '#/web/lib/dates.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { formatWorktreePath } from '#/web/lib/paths.ts'
import { remoteWorkspaceTarget } from '#/web/stores/workspaces/workspace-guards.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { PROTECTED_BRANCHES } from '#/shared/git-types.ts'
import { openUpstreamBranchExternalTarget } from '#/web/hooks/openBranchExternalTarget.ts'
import type { CurrentGitWorkspacePanePresentation } from '#/web/components/repo-workspace/model.ts'
import { CommitHashLink } from '#/web/components/repo-workspace/repo-link-actions.tsx'
import { useAppNavigation } from '#/web/app-navigation.tsx'
import { dispatchOpenWorkspacePaneStaticTabAction } from '#/web/workspace-pane/workspace-pane-tab-open-action.ts'
import { useStoreSelector } from '#/web/stores/store-selector.ts'
interface Props {
  detail: CurrentGitWorkspacePanePresentation
  workspaceRuntimeId: string
}

function SyncValue({
  ahead,
  behind,
  noUpstream,
  upToDateLabel,
  aheadLabel,
  behindLabel,
}: {
  ahead: number
  behind: number
  noUpstream: boolean
  upToDateLabel: string
  aheadLabel: string
  behindLabel: string
}) {
  if (noUpstream) return <StatusChip tone="attention">{upToDateLabel}</StatusChip>
  if (ahead === 0 && behind === 0) {
    return (
      <StatusChip tone="success">
        <Check size={11} />
        {upToDateLabel}
      </StatusChip>
    )
  }

  return (
    <>
      {ahead > 0 && (
        <StatusChip tone="success">
          <ArrowUp size={12} />
          {aheadLabel}
        </StatusChip>
      )}
      {behind > 0 && (
        <StatusChip tone="attention">
          <ArrowDown size={12} />
          {behindLabel}
        </StatusChip>
      )}
    </>
  )
}

const StatusCopyPatchButton = defineComponent<{ action: BranchCopyPatchAction }>({
  name: 'StatusCopyPatchButton',
  props: ['action'],
  setup(props) {
    const t = useT()
    const { succeeded, trigger } = useActionFeedback()

    function copyPatch(): void {
      if (props.action.busy || props.action.disabled) return
      trigger(props.action.onSelect)
    }

    return () => {
      const busy = !!props.action.busy
      const showCheck = succeeded.value && !busy
      const label = showCheck ? t('status.copy-patch-success') : (props.action.title ?? t('status.copy-patch-label'))
      return (
        <IconCopyButton
          label={label}
          succeeded={showCheck}
          busy={busy}
          disabled={props.action.disabled || busy}
          onClick={copyPatch}
        />
      )
    }
  },
})

// Clickable upstream ref (e.g. `origin/main`). Routes through
// `openUpstreamBranchExternalTarget` so the helper resolves the named
// remote instead of guessing from the local branch's tracking config.
interface UpstreamLinkProps {
  repoId: WorkspaceId
  workspaceRuntimeId: string
  tracking: string
  title: string
  tone?: Tone
}

const UpstreamLink = defineComponent<UpstreamLinkProps>({
  name: 'UpstreamLink',
  props: ['repoId', 'workspaceRuntimeId', 'tracking', 'title', 'tone'],
  setup(props) {
    const controller = new AbortController()
    const openExternally = throttle(
      () => {
        void openUpstreamBranchExternalTarget(props.repoId, props.workspaceRuntimeId, props.tracking).catch(() => {})
      },
      500,
      { edges: ['leading'], signal: controller.signal },
    )
    onScopeDispose(() => controller.abort('upstream-link-unmounted'))

    return () => (
      <StatusLink mono title={props.title} data-upstream-link="" tone={props.tone} truncate onClick={openExternally}>
        {props.tracking}
      </StatusLink>
    )
  },
})

export const BranchStatus = defineComponent<Props>({
  name: 'BranchStatus',
  props: ['detail', 'workspaceRuntimeId'],
  setup(props) {
    const branchActionSurface = useBranchActionSurface()
    const t = useT()
    const lang = useStoreSelector(i18nStore, (state) => state.lang)
    const compact = useIsCompactUi()
    const navigation = useAppNavigation()
    const workspaces = useStoreSelector(workspacesStore, (state) => state.workspaces)
    const throttleController = new AbortController()

    const createOpener = (type: 'files' | 'changes' | 'history') =>
      throttle(
        () => {
          const detail = props.detail
          const branchName = detail.branch?.name
          const worktreePath = detail.branch?.worktree?.path
          // History is branch-scoped; files and changes require a concrete worktree.
          if (!branchName || (type !== 'history' && !worktreePath)) return
          void dispatchOpenWorkspacePaneStaticTabAction({
            workspaceId: detail.workspaceId,
            branchName,
            worktreePath,
            type,
            workspacePaneRoute: { kind: 'static', tab: 'status' },
            navigation,
          })
        },
        500,
        { edges: ['leading'], signal: throttleController.signal },
      )
    const openFilesTab = createOpener('files')
    const openChangesTab = createOpener('changes')
    const openHistoryTab = createOpener('history')
    onScopeDispose(() => throttleController.abort('branch-status-unmounted'))

    return () => {
      const detail = props.detail
      const workspaceRuntimeId = props.workspaceRuntimeId
      const { branch, pullRequest } = detail
      if (!branch) return <EmptyState title={t('branches.empty')} />
      const { mainItems, destructiveItems, copyPatchAction } = branchActionSurface.value
      const repo = workspaces.value[detail.workspaceId]
      const worktreeTarget = repo
        ? remoteWorkspaceTarget(repo.id, repo.admission.kind === 'remote' ? repo.admission.lifecycle : null)
        : null
      const protectedBranch = PROTECTED_BRANCHES.has(branch.name)
      const worktreePath = branch.worktree?.path ? formatWorktreePath(branch.worktree?.path, worktreeTarget) : ''
      const worktreeChangeCount = detail.worktreeChanges?.changeCount
      const hasRole = branch.isDefault || protectedBranch
      // Gate on the same value the chip displays. If `worktreeChangeCount` is 0,
      // the row shows "0 changes" and there's nothing to copy — keep the
      // button hidden so we don't surface an action next to a contradictory chip.
      const hasWorktreeChanges = !!branch.worktree?.path && worktreeChangeCount !== undefined && worktreeChangeCount > 0
      const mergeKnown = branch.isDefault || branch.mergedToDefault !== undefined
      const showMerged = !branch.isDefault
      const commitTime = formatRelativeTimeOrNull(branch.lastCommitDate, lang.value)
      const commitMeta = commitTime
        ? branch.lastCommitAuthor
          ? `${branch.lastCommitAuthor} · ${commitTime}`
          : commitTime
        : null
      const mergeLabel = !mergeKnown
        ? t('branch-status.merge-unknown')
        : branch.mergedToDefault || branch.isDefault
          ? t('branch-status.merged')
          : t('branch-status.not-merged')
      const mergeTone: Tone = !mergeKnown ? 'neutral' : branch.mergedToDefault ? 'success' : 'attention'
      const upstreamTone: Tone = branch.trackingGone || !branch.tracking ? 'attention' : 'brand'
      const syncTone: Tone = !branch.tracking ? 'attention' : branch.behind > 0 ? 'attention' : 'success'
      const worktreeLocked = branch.worktree?.isLocked
      // The "dirty worktree" signal moved to its own row below; the worktree
      // row only needs to surface lock state on its own.
      const worktreeTone: Tone = worktreeLocked ? 'attention' : branch.worktree?.path ? 'brand' : 'neutral'
      const worktreeValue = branch.worktree?.path ? (
        <div class="inline-flex max-w-full min-w-0 items-center gap-1.5 align-middle">
          <StatusLink
            mono
            truncate
            title={t('workspace-pane-tabs.files-tooltip', { branch: branch.name })}
            onClick={openFilesTab}
          >
            {worktreePath}
          </StatusLink>
          <CopyButton
            value={branch.worktree.path}
            copyLabel={t('branch-status.copy-worktree-path')}
            copiedLabel={t('branch-status.copied')}
            class="shrink-0"
          />
        </div>
      ) : (
        <StatusChip>{t('branch-status.worktree.none')}</StatusChip>
      )
      const worktreeAfter = worktreeLocked ? (
        <StatusChip tone="attention">{t('branch-status.worktree.locked')}</StatusChip>
      ) : undefined
      const upstreamValue = branch.tracking ? (
        <UpstreamLink
          repoId={detail.workspaceId}
          workspaceRuntimeId={workspaceRuntimeId}
          tracking={branch.tracking}
          title={t('branch-status.upstream.open-externally')}
          tone={branch.trackingGone ? 'attention' : undefined}
        />
      ) : (
        <StatusChip tone="attention">{t('branches.no-upstream')}</StatusChip>
      )
      const upstreamAfter = branch.trackingGone ? (
        <StatusChip tone="attention">{t('branches.gone')}</StatusChip>
      ) : !branch.tracking && pullRequest ? (
        <StatusChip>{t('branch-status.upstream.pr-only')}</StatusChip>
      ) : undefined

      const roleChips = hasRole ? (
        <>
          {branch.isDefault && <StatusChip>{t('branches.default')}</StatusChip>}
          {protectedBranch && <StatusChip>{t('branch-status.protected')}</StatusChip>}
        </>
      ) : undefined
      // Surface the same pull/push/delete actions the sidebar branch row
      // exposes via its "..." menu, so users don't have to leave the status
      // tab for common operations. Anchored on the branch row (rather than
      // its own row) to keep the rest of the tab purely informational.
      //
      // `mainItems` comes from the shared action surface and its tab-nav
      // entries (changes/files/history) explicitly append, since most callers
      // of that surface (sidebar menu, shortcuts) aren't anchored to any
      // particular tab. From inside the status tab
      // itself we *are* anchored — swap those entries for the local
      // handlers above so opening a tab from this menu follows the same
      // "insert right after status" placement as the inline links in this
      // panel (worktree path, changes count).
      const statusTabAnchoredOpeners: Partial<Record<BranchActionItem['id'], () => void>> = {
        files: openFilesTab,
        changes: openChangesTab,
        history: openHistoryTab,
      }
      const branchActionMenuItems = mainItems.map((item) => {
        const onSelect = statusTabAnchoredOpeners[item.id]
        return onSelect ? { ...item, onSelect } : item
      })
      const branchActionsMenu = (
        <BranchActionsPopover mainItems={branchActionMenuItems} destructiveItems={destructiveItems} />
      )
      return (
        <StatusRows>
          <StatusRow
            icon={<GitBranch size={15} />}
            label={t('branch-status.signal.branch')}
            value={
              <CopyableValue
                value={branch.name}
                copyLabel={t('branch-status.copy-branch-name')}
                copiedLabel={t('branch-status.copied')}
              />
            }
            after={
              <>
                {roleChips}
                {branchActionsMenu}
              </>
            }
            valueLayout="inline"
            tone={branch.isDefault ? 'brand' : 'neutral'}
          />
          <StatusRow
            icon={<FolderTree size={14} />}
            label={t('branch-status.signal.worktree')}
            value={worktreeValue}
            after={worktreeAfter}
            valueLayout="inline"
            tone={worktreeTone}
          />
          {hasWorktreeChanges && (
            <StatusRow
              icon={<Diff size={14} />}
              label={t('branch-status.signal.changes')}
              value={
                <ClickableStatusChip
                  tone="attention"
                  title={t('workspace-pane-tabs.changes-tooltip', { count: worktreeChangeCount })}
                  onClick={openChangesTab}
                >
                  {t('branch-status.changes-count', { n: worktreeChangeCount })}
                </ClickableStatusChip>
              }
              after={copyPatchAction.visible ? <StatusCopyPatchButton action={copyPatchAction} /> : undefined}
              valueLayout="inline"
              tone="attention"
            />
          )}
          <StatusRow
            icon={<RadioTower size={14} />}
            label={t('branch-status.signal.upstream')}
            value={upstreamValue}
            after={upstreamAfter}
            valueLayout="inline"
            tone={upstreamTone}
          />
          <StatusRow
            icon={<RefreshCw size={14} />}
            label={t('branch-status.signal.sync')}
            value={
              <SyncValue
                ahead={branch.ahead}
                behind={branch.behind}
                noUpstream={!branch.tracking}
                upToDateLabel={!branch.tracking ? t('branches.no-upstream') : t('branch-status.sync.up-to-date')}
                aheadLabel={t('branch-status.sync.ahead', { n: branch.ahead })}
                behindLabel={t('branch-status.sync.behind', { n: branch.behind })}
              />
            }
            valueLayout="chips"
            tone={syncTone}
          />
          <StatusRow
            icon={<GitCommitHorizontal size={14} />}
            label={t('branch-status.signal.commit')}
            value={
              <div class="flex min-w-0 flex-nowrap items-center gap-2 overflow-hidden text-sm text-foreground">
                {branch.lastCommitHash ? (
                  <CommitHashLink
                    repoId={detail.workspaceId}
                    workspaceRuntimeId={workspaceRuntimeId}
                    hash={branch.lastCommitHash}
                    shortHash={branch.lastCommitShortHash}
                    title={t('branch-status.commit.open-externally')}
                    data-commit-link=""
                    tone="brand"
                    class="shrink-0 text-sm font-medium tabular-nums leading-none text-brand-text/85"
                  />
                ) : null}
                <span
                  class="min-w-0 truncate leading-tight text-foreground/95"
                  title={branch.lastCommitMessage || undefined}
                >
                  {branch.lastCommitMessage || '—'}
                </span>
                {commitMeta && (
                  <span
                    class="shrink-0 whitespace-nowrap text-xs leading-tight text-muted-foreground"
                    title={commitMeta}
                  >
                    {commitMeta}
                  </span>
                )}
              </div>
            }
            valueLayout="fill"
          />
          {showMerged && (
            <StatusRow
              icon={<GitMerge size={14} />}
              label={t('branch-status.signal.merge')}
              value={
                <StatusChip tone={mergeTone}>
                  {mergeKnown && branch.mergedToDefault && <Check size={11} />}
                  {mergeLabel}
                </StatusChip>
              }
              valueLayout="chips"
              tone={mergeTone}
            />
          )}
          <PullRequestStatusRow
            repoId={detail.workspaceId}
            workspaceRuntimeId={workspaceRuntimeId}
            branchName={branch.name}
            pullRequest={pullRequest}
            read={detail.pullRequestRead}
            tooltipSide={compact.value ? 'top' : 'bottom'}
          />
        </StatusRows>
      )
    }
  },
})
