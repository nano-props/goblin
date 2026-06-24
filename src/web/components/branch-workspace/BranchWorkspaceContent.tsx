import { FolderTree } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useT } from '#/web/stores/i18n.ts'
import { EmptyState, ScrollPane } from '#/web/components/Layout.tsx'
import { StatusListSkeleton } from '#/web/components/Skeleton.tsx'
import { StatusList } from '#/web/components/StatusList.tsx'
import { getRepositoryLog } from '#/web/repo-client.ts'
import type { LogEntry } from '#/web/types.ts'
import { BranchStatus } from '#/web/components/branch-workspace/BranchStatus.tsx'
import { TerminalSlot } from '#/web/components/terminal/TerminalSlot.tsx'
import type { TerminalSlotBase } from '#/web/components/terminal/types.ts'
import type {
  BranchWorkspaceRepo,
  SelectedBranchWorkspacePresentation,
} from '#/web/components/branch-workspace/model.ts'
import { worktreeTerminalKey } from '#/web/components/terminal/terminal-slot-keys.ts'
import {
  useTerminalRepoSyncReady,
  useWorktreeTerminalSnapshot,
} from '#/web/components/terminal/terminal-slot-store.ts'
import { workspacePaneViewButtonId } from '#/web/components/workspace-pane/workspace-pane-view-model.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { workspacePaneStaticViewButtonId } from '#/web/components/branch-workspace/workspace-pane-views.ts'
import { DEFAULT_REPOSITORY_LOG_COUNT } from '#/shared/git-types.ts'
import type { WorkspacePaneStaticViewType } from '#/shared/workspace-pane.ts'
import { workspacePaneTabOrderForBranch } from '#/web/stores/repos/workspace-pane-tabs.ts'
import {
  createBranchWorkspacePaneTabModel,
  type BranchWorkspacePaneTab,
  type BranchWorkspacePaneSelection,
} from '#/web/components/branch-workspace/workspace-pane-tab-model.ts'
import { preferredWorkspacePaneViewForBranch } from '#/web/stores/repos/workspace-pane-preferences.ts'
import { useTerminalSlotContext } from '#/web/components/terminal/terminal-slot-context.ts'
import { createWorkspacePaneTerminalTab } from '#/web/stores/repos/workspace-pane-terminal-write-paths.ts'

const DEFAULT_BRANCH_HISTORY_ERROR_KEY = 'error.failed-read-repo'

interface Props {
  repo: Pick<BranchWorkspaceRepo, 'id' | 'data' | 'ui'> & {
    data: BranchWorkspaceRepo['data'] & Pick<BranchWorkspaceRepo['data'], 'statusLoaded'>
  }
  detail: SelectedBranchWorkspacePresentation
  workspacePaneId: string
}

interface TabPanelProps {
  id: string
  labelledById?: string
  label?: string
  busy?: boolean
  children: ReactNode
}

type BranchWorkspaceBranch = NonNullable<SelectedBranchWorkspacePresentation['branch']>

// Pure view: the workspace pane body is derived from the repos store's
// branch-scoped preferred view and the live terminal session truth. The store
// never re-projects on snapshot refresh, branch switch, or session restore.
// The tab model keeps the body render target separate from the active
// materialized tab.
export function BranchWorkspaceContent({ repo, detail, workspacePaneId }: Props) {
  const t = useT()
  const compact = useIsCompactUi()
  const { branch } = detail
  const terminalWorktreeKey = branch?.worktree?.path ? worktreeTerminalKey(repo.id, branch.worktree.path) : null
  const worktreeSnapshot = useWorktreeTerminalSnapshot(terminalWorktreeKey)
  const terminalSyncReady = useTerminalRepoSyncReady(repo.id)
  const workspacePaneTabOrder = workspacePaneTabOrderForBranch(repo.ui, branch?.name)
  const workspacePaneTabModel = createBranchWorkspacePaneTabModel({
    repoId: repo.id,
    branchName: branch?.name ?? null,
    worktreePath: branch?.worktree?.path ?? null,
    preferredView: preferredWorkspacePaneViewForBranch(repo.ui, branch?.name),
    tabOrder: workspacePaneTabOrder,
    runtimeTerminalViews: worktreeSnapshot.slots,
    terminalSessionCount: worktreeSnapshot.count,
    terminalCreatePending: worktreeSnapshot.pendingCreate,
    terminalSyncReady,
    lastClosedTabContext: branch ? (repo.ui.lastClosedTabContextByBranch[branch.name] ?? null) : null,
  })
  const selection = workspacePaneTabModel.selection
  const renderedView = selection?.view ?? null
  const panelLabel = workspacePanePanelLabel({
    selection,
    tabs: workspacePaneTabModel.tabs,
    workspacePaneId,
    compact,
    t,
    terminalSyncReady,
    terminalCreatePending: worktreeSnapshot.pendingCreate,
  })
  const noBranchTitleKey = repo.data.branches.length === 0 ? 'branches.empty' : 'branches.filter-empty'
  if (!branch) return <EmptyState title={t(noBranchTitleKey)} />

  if (!selection) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <EmptyState title={t('workspace-pane-views.empty')} />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {renderedView === 'status' && (
        <BranchStatusTab
          workspacePaneId={workspacePaneId}
          panelLabel={panelLabel}
          detail={detail}
          busy={detail.loading.pullRequests}
        />
      )}
      {renderedView === 'history' && (
        <BranchHistoryTab
          repoId={repo.id}
          branchName={branch.name}
          workspacePaneId={workspacePaneId}
          panelLabel={panelLabel}
        />
      )}
      {renderedView === 'changes' && (
        <BranchChangesTab
          workspacePaneId={workspacePaneId}
          panelLabel={panelLabel}
          repo={repo}
          branch={branch}
          selectedStatus={detail.selectedStatus}
          statusLoading={detail.loading.status}
          statusError={detail.errors.status}
          statusStale={detail.stale.status}
        />
      )}
      {renderedView === 'terminal' && branch.worktree?.path && (
        <BranchTerminalTab
          workspacePaneId={workspacePaneId}
          panelLabel={panelLabel}
          repoId={repo.id}
          terminalSyncReady={terminalSyncReady}
          branch={branch}
        />
      )}
    </div>
  )
}

type WorkspacePanePanelLabel = Pick<TabPanelProps, 'labelledById' | 'label'>

function workspacePanePanelLabel(input: {
  selection: BranchWorkspacePaneSelection | null
  tabs: readonly BranchWorkspacePaneTab[]
  workspacePaneId: string
  compact: boolean
  t: (key: string, params?: Record<string, string | number>) => string
  terminalSyncReady: boolean
  terminalCreatePending: boolean
}): WorkspacePanePanelLabel {
  const tab = input.selection?.kind === 'materialized-tab' ? input.selection.tab : null
  if (tab?.kind === 'terminal') {
    const terminalTabs = input.tabs.filter((candidate) => candidate.kind === 'terminal')
    const index = terminalTabs.findIndex((candidate) => candidate.identity === tab.identity)
    return { labelledById: workspacePaneViewButtonId(input.workspacePaneId, input.compact ? 0 : Math.max(0, index)) }
  }
  if (tab?.kind === 'static') {
    return { labelledById: workspacePaneStaticViewButtonId(input.workspacePaneId, tab.type as WorkspacePaneStaticViewType) }
  }
  const pendingTab = input.tabs.find((candidate) => candidate.kind === 'pending')
  if (pendingTab) {
    return { labelledById: `${input.workspacePaneId}-${pendingTab.type}-pending-tab` }
  }
  const terminalPanelLabelKey =
    input.terminalCreatePending || input.terminalSyncReady ? 'terminal.opening' : 'terminal.loading'
  return { label: input.t(terminalPanelLabelKey) }
}

function BranchHistoryTab({
  repoId,
  branchName,
  workspacePaneId,
  panelLabel,
}: {
  repoId: string
  branchName: string
  workspacePaneId: string
  panelLabel: WorkspacePanePanelLabel
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

  const errorTitleKey = state.error ?? DEFAULT_BRANCH_HISTORY_ERROR_KEY

  return (
    <BranchTabPanel
      id={`${workspacePaneId}-history-panel`}
      {...panelLabel}
      busy={state.phase === 'loading'}
    >
      {state.phase === 'loading' ? (
        <StatusListSkeleton rows={8} />
      ) : state.phase === 'error' ? (
        <EmptyState title={t(errorTitleKey)} />
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

function BranchTabPanel({ id, labelledById, label, busy = false, children }: TabPanelProps) {
  return (
    <div
      id={id}
      role="tabpanel"
      aria-busy={busy || undefined}
      aria-labelledby={labelledById}
      aria-label={labelledById ? undefined : label}
      className="flex min-h-0 flex-1 flex-col"
    >
      {children}
    </div>
  )
}

function BranchStatusTab({
  workspacePaneId,
  panelLabel,
  detail,
  busy,
}: {
  workspacePaneId: string
  panelLabel: WorkspacePanePanelLabel
  detail: SelectedBranchWorkspacePresentation
  busy?: boolean
}) {
  return (
    <BranchTabPanel id={`${workspacePaneId}-status-panel`} {...panelLabel} busy={busy}>
      <ScrollPane>
        <BranchStatus detail={detail} />
      </ScrollPane>
    </BranchTabPanel>
  )
}

function BranchTerminalTab({
  workspacePaneId,
  panelLabel,
  repoId,
  terminalSyncReady,
  branch,
}: {
  workspacePaneId: string
  panelLabel: WorkspacePanePanelLabel
  repoId: string
  terminalSyncReady: boolean
  branch: BranchWorkspaceBranch
}) {
  const { createTerminal } = useTerminalSlotContext()
  const createTerminalForSlot = useCallback(
    (base: TerminalSlotBase) =>
      createWorkspacePaneTerminalTab({
        base,
        createTerminal,
      }),
    [createTerminal],
  )
  if (!branch.worktree?.path) return null
  return (
    <BranchTabPanel id={`${workspacePaneId}-terminal-panel`} {...panelLabel}>
      <TerminalSlot
        repoRoot={repoId}
        branch={branch.name}
        worktreePath={branch.worktree?.path}
        syncReady={terminalSyncReady}
        createTerminalForSlot={createTerminalForSlot}
      />
    </BranchTabPanel>
  )
}

function BranchChangesTab({
  workspacePaneId,
  panelLabel,
  repo,
  branch,
  selectedStatus,
  statusLoading,
  statusError,
  statusStale,
}: {
  workspacePaneId: string
  panelLabel: WorkspacePanePanelLabel
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
    <BranchTabPanel id={`${workspacePaneId}-changes-panel`} {...panelLabel} busy={statusLoading}>
      {branch.worktree?.path && statusLoading && !repo.data.statusLoaded ? (
        <StatusListSkeleton rows={8} />
      ) : branch.worktree?.path && !repo.data.statusLoaded && statusError ? (
        <EmptyState title={t(statusError)} />
      ) : branch.worktree?.path ? (
        <div className="relative flex min-h-0 flex-1 flex-col">
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
