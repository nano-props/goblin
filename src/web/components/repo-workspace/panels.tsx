import { FolderTree } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useT } from '#/web/stores/i18n.ts'
import { EmptyState, ScrollPane } from '#/web/components/Layout.tsx'
import { StatusListSkeleton } from '#/web/components/Skeleton.tsx'
import { StatusList } from '#/web/components/StatusList.tsx'
import { getRepoLog } from '#/web/repo-client.ts'
import type { LogEntry } from '#/web/types.ts'
import { BranchStatus } from '#/web/components/repo-workspace/BranchStatus.tsx'
import { TerminalSessionView } from '#/web/components/terminal/TerminalSessionView.tsx'
import type { TerminalSessionBase } from '#/web/components/terminal/types.ts'
import type { RepoWorkspaceRepo, SelectedRepoWorkspacePresentation } from '#/web/components/repo-workspace/model.ts'
import { DEFAULT_REPOSITORY_LOG_COUNT } from '#/shared/git-types.ts'
import type { WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import { useTerminalSessionContext } from '#/web/components/terminal/terminal-session-context.ts'
import { runCreateTerminalTabCommand } from '#/web/commands/terminal-create-command.ts'
import type { WorkspacePanePanelLabel } from '#/web/components/workspace-pane/tab-providers.ts'

const DEFAULT_BRANCH_HISTORY_ERROR_KEY = 'error.failed-read-repo'

export interface WorkspacePanePanelRenderInput {
  type: WorkspacePaneTabType
  repo: Pick<RepoWorkspaceRepo, 'id' | 'data' | 'ui'> & {
    data: RepoWorkspaceRepo['data'] & Pick<RepoWorkspaceRepo['data'], 'statusLoaded'>
  }
  detail: SelectedRepoWorkspacePresentation
  workspacePaneId: string
  panelLabel: WorkspacePanePanelLabel
  terminalSyncReady: boolean
}

interface WorkspacePanePanelProps extends Omit<WorkspacePanePanelRenderInput, 'type'> {}

interface TabPanelProps {
  id: string
  labelledById?: string
  label?: string
  busy?: boolean
  children: ReactNode
}

type BranchWorkspaceBranch = NonNullable<SelectedRepoWorkspacePresentation['branch']>
type WorkspacePanePanelComponent = (props: WorkspacePanePanelProps) => ReactNode

const BRANCH_WORKSPACE_PANE_PANEL_BY_TYPE = {
  status: StatusWorkspacePanePanel,
  changes: ChangesWorkspacePanePanel,
  history: HistoryWorkspacePanePanel,
  terminal: TerminalWorkspacePanePanel,
} satisfies Record<WorkspacePaneTabType, WorkspacePanePanelComponent>

export function renderBranchWorkspacePanePanel(input: WorkspacePanePanelRenderInput): ReactNode {
  const Panel = BRANCH_WORKSPACE_PANE_PANEL_BY_TYPE[input.type]
  return <Panel {...input} />
}

function StatusWorkspacePanePanel({ workspacePaneId, panelLabel, detail }: WorkspacePanePanelProps) {
  return (
    <BranchTabPanel id={`${workspacePaneId}-status-panel`} {...panelLabel} busy={detail.loading.pullRequests}>
      <ScrollPane>
        <BranchStatus detail={detail} />
      </ScrollPane>
    </BranchTabPanel>
  )
}

function HistoryWorkspacePanePanel({ repo, detail, workspacePaneId, panelLabel }: WorkspacePanePanelProps) {
  const branch = detail.branch
  if (!branch) return null
  return (
    <BranchHistoryTab
      repoId={repo.id}
      branchName={branch.name}
      workspacePaneId={workspacePaneId}
      panelLabel={panelLabel}
    />
  )
}

function ChangesWorkspacePanePanel({ repo, detail, workspacePaneId, panelLabel }: WorkspacePanePanelProps) {
  const branch = detail.branch
  if (!branch) return null
  return (
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
  )
}

function TerminalWorkspacePanePanel({
  repo,
  detail,
  workspacePaneId,
  panelLabel,
  terminalSyncReady,
}: WorkspacePanePanelProps) {
  const branch = detail.branch
  if (!branch?.worktree?.path) return null
  return (
    <BranchTerminalTab
      workspacePaneId={workspacePaneId}
      panelLabel={panelLabel}
      repoId={repo.id}
      terminalSyncReady={terminalSyncReady}
      branch={branch}
    />
  )
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
    void getRepoLog(repoId, branchName, { count: DEFAULT_REPOSITORY_LOG_COUNT, signal: ctrl.signal })
      .then((entries) => {
        if (!ctrl.signal.aborted) setState({ phase: 'loaded', entries, error: null })
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return
        setState({
          phase: 'error',
          entries: [],
          error: err instanceof Error ? err.message : DEFAULT_BRANCH_HISTORY_ERROR_KEY,
        })
      })
    return () => ctrl.abort()
  }, [branchName, repoId])

  const errorTitleKey = state.error ?? DEFAULT_BRANCH_HISTORY_ERROR_KEY

  return (
    <BranchTabPanel id={`${workspacePaneId}-history-panel`} {...panelLabel} busy={state.phase === 'loading'}>
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
  const { createTerminal } = useTerminalSessionContext()
  const t = useT()
  const createTerminalForSlot = useCallback(
    async (base: TerminalSessionBase) => {
      await runCreateTerminalTabCommand({
        base,
        createTerminal,
        t,
        logMessage: 'workspace pane terminal create failed',
      })
    },
    [createTerminal, t],
  )
  if (!branch.worktree?.path) return null
  return (
    <BranchTabPanel id={`${workspacePaneId}-terminal-panel`} {...panelLabel}>
      <TerminalSessionView
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
  repo: WorkspacePanePanelRenderInput['repo']
  branch: BranchWorkspaceBranch
  selectedStatus: SelectedRepoWorkspacePresentation['selectedStatus']
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
      <span className="text-muted-foreground">
        {' \u2014 '}
        {t(message)}
      </span>
    </div>
  )
}
