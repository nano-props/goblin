import { FolderTree } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useT } from '#/web/stores/i18n.ts'
import { EmptyState, ScrollPane } from '#/web/components/Layout.tsx'
import { StatusListSkeleton } from '#/web/components/Skeleton.tsx'
import { StatusList } from '#/web/components/StatusList.tsx'
import { getRepositoryLog } from '#/web/repo-client.ts'
import type { LogEntry } from '#/web/types.ts'
import { BranchStatus } from '#/web/components/branch-workspace/BranchStatus.tsx'
import { TerminalSlot } from '#/web/components/terminal/TerminalSlot.tsx'
import type {
  BranchWorkspaceRepo,
  SelectedBranchWorkspacePresentation,
} from '#/web/components/branch-workspace/model.ts'
import { useEffectiveWorkspacePaneView } from '#/web/components/branch-workspace/useEffectiveWorkspacePaneView.ts'
import { worktreeTerminalKey } from '#/web/components/terminal/terminal-session-keys.ts'
import { useWorktreeTerminalSnapshot } from '#/web/components/terminal/terminal-session-store.ts'
import {
  activeWorkspacePaneViewIdentity,
  workspacePaneViewButtonId,
  workspacePaneViewIdentity,
} from '#/web/components/workspace-pane/workspace-pane-view-model.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { branchLevelWorkspacePaneViewButtonId } from '#/web/components/branch-workspace/workspace-pane-views.ts'
import { DEFAULT_REPOSITORY_LOG_COUNT } from '#/shared/git-types.ts'
import { branchWorkspacePaneViewsForBranch } from '#/web/stores/repos/branch-workspace-pane-views.ts'
import { isBranchLevelWorkspacePaneView } from '#/web/lib/workspace-pane-view.ts'
interface Props {
  repo: Pick<BranchWorkspaceRepo, 'id' | 'data' | 'ui'> & {
    data: BranchWorkspaceRepo['data'] & Pick<BranchWorkspaceRepo['data'], 'statusLoaded'>
  }
  detail: SelectedBranchWorkspacePresentation
  workspacePaneId: string
}

interface TabPanelProps {
  id: string
  labelledById: string
  busy?: boolean
  children: ReactNode
}

type BranchWorkspaceBranch = NonNullable<SelectedBranchWorkspacePresentation['branch']>

// Pure view: the renderable tab is derived from the repos store's
// branch-scoped selected tab and the live terminal session truth via
// `useEffectiveWorkspacePaneView`. The store never re-projects on snapshot
// refresh, branch switch, or session restore; this component is read-only.
export function BranchWorkspaceContent({ repo, detail, workspacePaneId }: Props) {
  const t = useT()
  const compact = useIsCompactUi()
  const effectiveTab = useEffectiveWorkspacePaneView(repo)
  const { branch } = detail
  const openBranchWorkspacePaneViews = branchWorkspacePaneViewsForBranch(repo.ui, branch?.name)
  const effectiveBranchTab = isBranchLevelWorkspacePaneView(effectiveTab) ? effectiveTab : null
  const terminalWorktreeKey = branch?.worktree?.path ? worktreeTerminalKey(repo.id, branch.worktree.path) : null
  const worktreeSnapshot = useWorktreeTerminalSnapshot(terminalWorktreeKey)
  const worktreeWorkspacePaneViews = worktreeSnapshot.workspacePaneViews.filter((view) => {
    return !isBranchLevelWorkspacePaneView(view.type) || openBranchWorkspacePaneViews.includes(view.type)
  })
  const activeTabIdentity = activeWorkspacePaneViewIdentity(worktreeWorkspacePaneViews, effectiveTab)
  const activeTabIndex = activeTabIdentity
    ? worktreeWorkspacePaneViews.findIndex((tab) => workspacePaneViewIdentity(tab) === activeTabIdentity)
    : -1
  const branchStaticWorktreeFallbackActive =
    !!effectiveBranchTab &&
    !!terminalWorktreeKey &&
    activeTabIndex === -1 &&
    openBranchWorkspacePaneViews.includes(effectiveBranchTab)
  const branchStaticWorktreeFallbackIndex = branchStaticWorktreeFallbackActive && effectiveBranchTab
    ? Math.max(0, openBranchWorkspacePaneViews.indexOf(effectiveBranchTab))
    : 0
  const activeTabLabelledById =
    activeTabIndex >= 0
      ? workspacePaneViewButtonId(workspacePaneId, compact ? 0 : activeTabIndex)
      : branchStaticWorktreeFallbackActive
        ? workspacePaneViewButtonId(workspacePaneId, compact ? 0 : branchStaticWorktreeFallbackIndex)
        : effectiveBranchTab
          ? branchLevelWorkspacePaneViewButtonId(workspacePaneId, effectiveBranchTab)
          : workspacePaneViewButtonId(workspacePaneId, 0)
  const terminalPendingCreate = effectiveTab === 'terminal' && worktreeSnapshot.pendingCreate
  const branchStaticTabActive =
    !!effectiveBranchTab && (activeTabIndex >= 0 || openBranchWorkspacePaneViews.includes(effectiveBranchTab))
  if (!branch)
    return <EmptyState title={t(repo.data.branches.length === 0 ? 'branches.empty' : 'branches.filter-empty')} />

  if (!activeTabIdentity && !terminalPendingCreate && !branchStaticTabActive) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <EmptyState title={t('workspace-pane-views.empty')} />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {effectiveTab === 'status' && (
        <BranchStatusTab
          workspacePaneId={workspacePaneId}
          labelledById={activeTabLabelledById}
          detail={detail}
          busy={detail.loading.pullRequests}
        />
      )}
      {effectiveTab === 'history' && (
        <BranchHistoryTab
          repoId={repo.id}
          branchName={branch.name}
          workspacePaneId={workspacePaneId}
          labelledById={activeTabLabelledById}
        />
      )}
      {effectiveTab === 'changes' && (
        <BranchChangesTab
          workspacePaneId={workspacePaneId}
          labelledById={activeTabLabelledById}
          repo={repo}
          branch={branch}
          selectedStatus={detail.selectedStatus}
          statusLoading={detail.loading.status}
          statusError={detail.errors.status}
          statusStale={detail.stale.status}
        />
      )}
      {effectiveTab === 'terminal' && branch.worktree?.path && (
        <BranchTerminalTab
          workspacePaneId={workspacePaneId}
          labelledById={activeTabLabelledById}
          repoId={repo.id}
          branch={branch}
        />
      )}
    </div>
  )
}

function BranchHistoryTab({
  repoId,
  branchName,
  workspacePaneId,
  labelledById,
}: {
  repoId: string
  branchName: string
  workspacePaneId: string
  labelledById: string
}) {
  const t = useT()
  const [state, setState] = useState<{
    phase: 'loading' | 'loaded' | 'error'
    entries: LogEntry[]
    error: string | null
  }>({
    phase: 'loading',
    entries: [],
    error: null,
  })

  useEffect(() => {
    const ctrl = new AbortController()
    setState({ phase: 'loading', entries: [], error: null })
    void getRepositoryLog(repoId, branchName, { count: DEFAULT_REPOSITORY_LOG_COUNT, signal: ctrl.signal })
      .then((entries) => {
        if (!ctrl.signal.aborted) setState({ phase: 'loaded', entries, error: null })
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return
        setState({
          phase: 'error',
          entries: [],
          error: err instanceof Error ? err.message : 'error.failed-read-repo',
        })
      })
    return () => ctrl.abort()
  }, [branchName, repoId])

  return (
    <BranchTabPanel id={`${workspacePaneId}-history-panel`} labelledById={labelledById} busy={state.phase === 'loading'}>
      {state.phase === 'loading' ? (
        <StatusListSkeleton rows={8} />
      ) : state.phase === 'error' ? (
        <EmptyState title={t(state.error ?? 'error.failed-read-repo')} />
      ) : state.entries.length === 0 ? (
        <EmptyState title={t('log.empty-for-branch', { branch: branchName })} />
      ) : (
        <ScrollPane>
          <ul className="py-1.5 tracking-wider" style={{ fontFamily: 'var(--font-mono)' }}>
            {state.entries.map((entry) => (
              <BranchHistoryRow key={entry.hash || entry.shortHash} entry={entry} />
            ))}
          </ul>
        </ScrollPane>
      )}
    </BranchTabPanel>
  )
}

function BranchHistoryRow({ entry }: { entry: LogEntry }) {
  const hash = entry.shortHash || entry.hash
  const refs = entry.refs.trim()
  const line = historyLogLine(entry)
  return (
    <li className="min-w-0 px-1.5 font-mono text-sm text-foreground" title={line}>
      <span className="block w-full min-w-0 truncate">
        <span data-history-log-hash="" style={{ color: 'var(--color-terminal-ansi-yellow)' }}>
          {hash}
        </span>
        {refs ? (
          <>
            {' '}
            <span>(</span>
            <BranchHistoryRefs refs={refs} />
            <span>)</span>
          </>
        ) : null}
        {entry.message ? (
          <>
            {' '}
            <span data-history-log-message="">{entry.message}</span>
          </>
        ) : null}
      </span>
    </li>
  )
}

function BranchHistoryRefs({ refs }: { refs: string }) {
  return (
    <>
      {refs
        .split(/(,\s*|\s+|->)/g)
        .filter(Boolean)
        .map((part, index) => {
          const color = historyRefTokenColor(part)
          return (
            <span
              key={`${part}-${index}`}
              data-history-log-ref-token={part.trim() || undefined}
              style={color ? { color } : undefined}
            >
              {part}
            </span>
          )
        })}
    </>
  )
}

function historyRefTokenColor(token: string): string | null {
  const text = token.trim()
  if (!text || text.startsWith(',')) return null
  if (text === 'HEAD' || text === '->') return 'var(--color-terminal-ansi-blue)'
  if (text === 'tag:') return 'var(--color-terminal-ansi-magenta)'
  if (/^(origin|upstream|fork)\//.test(text)) return 'var(--color-terminal-ansi-red)'
  return 'var(--color-terminal-ansi-green)'
}

function historyLogLine(entry: LogEntry): string {
  const hash = entry.shortHash || entry.hash
  const refs = entry.refs.trim()
  return [hash, refs ? `(${refs})` : '', entry.message].filter(Boolean).join(' ')
}

function BranchTabPanel({ id, labelledById, busy = false, children }: TabPanelProps) {
  return (
    <div
      id={id}
      role="tabpanel"
      aria-busy={busy || undefined}
      aria-labelledby={labelledById}
      className="flex min-h-0 flex-1 flex-col"
    >
      {children}
    </div>
  )
}

function BranchStatusTab({
  workspacePaneId,
  labelledById,
  detail,
  busy,
}: {
  workspacePaneId: string
  labelledById: string
  detail: SelectedBranchWorkspacePresentation
  busy?: boolean
}) {
  return (
    <BranchTabPanel id={`${workspacePaneId}-status-panel`} labelledById={labelledById} busy={busy}>
      <ScrollPane>
        <BranchStatus detail={detail} />
      </ScrollPane>
    </BranchTabPanel>
  )
}

function BranchTerminalTab({
  workspacePaneId,
  labelledById,
  repoId,
  branch,
}: {
  workspacePaneId: string
  labelledById: string
  repoId: string
  branch: BranchWorkspaceBranch
}) {
  if (!branch.worktree?.path) return null
  return (
    <BranchTabPanel id={`${workspacePaneId}-terminal-panel`} labelledById={labelledById}>
      <TerminalSlot repoRoot={repoId} branch={branch.name} worktreePath={branch.worktree?.path} />
    </BranchTabPanel>
  )
}

function BranchChangesTab({
  workspacePaneId,
  labelledById,
  repo,
  branch,
  selectedStatus,
  statusLoading,
  statusError,
  statusStale,
}: {
  workspacePaneId: string
  labelledById: string
  repo: Props['repo']
  branch: BranchWorkspaceBranch
  selectedStatus: SelectedBranchWorkspacePresentation['selectedStatus']
  statusLoading: boolean
  statusError: string | null
  statusStale: boolean
}) {
  const t = useT()
  const totalEntries = selectedStatus.reduce((n, wt) => n + wt.entries.length, 0)

  return (
    <BranchTabPanel id={`${workspacePaneId}-changes-panel`} labelledById={labelledById} busy={statusLoading}>
      {branch.worktree?.path && statusLoading && !repo.data.statusLoaded ? (
        <StatusListSkeleton rows={8} />
      ) : branch.worktree?.path && !repo.data.statusLoaded && statusError ? (
        <EmptyState title={t(statusError)} />
      ) : branch.worktree?.path ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {statusStale && statusError && <StaleStatusNotice message={statusError} />}
          {totalEntries > 0 ? (
            <ScrollPane>
              <StatusList status={selectedStatus} />
            </ScrollPane>
          ) : (
            <StatusList status={selectedStatus} />
          )}
        </div>
      ) : (
        <EmptyState
          icon={<FolderTree size={16} />}
          title={t('status.no-worktree-title')}
          body={t('status.no-worktree-body')}
        />
      )}
    </BranchTabPanel>
  )
}

function StaleStatusNotice({ message }: { message: string }) {
  const t = useT()
  return (
    <div className="border-b border-warning-border bg-warning-surface px-4 py-2 text-xs text-warning">
      <span className="font-medium">{t('status.stale-title')}</span>
      <span className="text-muted-foreground"> — {t(message)}</span>
    </div>
  )
}
