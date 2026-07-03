import { FolderTree } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Key } from 'react-aria-components'
import { toast } from 'sonner'
import { useT } from '#/web/stores/i18n.ts'
import { EmptyState, ScrollPane } from '#/web/components/Layout.tsx'
import { StatusListSkeleton } from '#/web/components/Skeleton.tsx'
import { StatusList } from '#/web/components/StatusList.tsx'
import { getRepoLog } from '#/web/repo-client.ts'
import type { LogEntry } from '#/web/types.ts'
import { BranchStatus } from '#/web/components/repo-workspace/BranchStatus.tsx'
import { FiletreeNoWorktreeView, FiletreeView } from '#/web/components/repo-workspace/FiletreeView.tsx'
import { useLazyRepoTree } from '#/web/hooks/useLazyRepoTree.ts'
import { TerminalSessionView } from '#/web/components/terminal/TerminalSessionView.tsx'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import type { RepoTreeNode } from '#/shared/api-types.ts'
import type { RepoWorkspaceRepo, SelectedRepoWorkspacePresentation } from '#/web/components/repo-workspace/model.ts'
import { DEFAULT_REPOSITORY_LOG_COUNT } from '#/shared/git-types.ts'
import type { WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import { useTerminalSessionContext } from '#/web/components/terminal/terminal-session-context.ts'
import { runCreateTerminalTabCommand } from '#/web/commands/terminal-create-command.ts'
import { captureWorkspacePaneActiveTabIdentity } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import type { WorkspacePanePanelLabel } from '#/web/components/workspace-pane/tab-providers.ts'
import { usePrimaryWindowNavigation } from '#/web/primary-window-navigation.tsx'
import { useFiletreeActionDialogsStore } from '#/web/stores/repos/filetree-action-dialogs.ts'
import {
  emptyFiletreeInteractionSnapshot,
  filetreeInteractionScopeKey,
  useFiletreeInteractionStore,
} from '#/web/stores/repos/filetree-interaction-state.ts'
import { getRepositoryFileViewer } from '#/web/filetree-client.ts'
import { absoluteFilePathForTerminal, fileReadCommand } from '#/web/components/repo-workspace/file-read-command.ts'
import {
  HistoryCommitGraph,
  HistoryCommitGraphSkeleton,
} from '#/web/components/repo-workspace/HistoryCommitGraph.tsx'

const DEFAULT_BRANCH_HISTORY_ERROR_KEY = 'error.failed-read-repo'

export interface WorkspacePanePanelRenderInput {
  type: WorkspacePaneTabType
  repo: Pick<RepoWorkspaceRepo, 'id' | 'instanceId' | 'data' | 'ui'> & {
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

type RepoWorkspaceBranch = NonNullable<SelectedRepoWorkspacePresentation['branch']>
type WorkspacePanePanelComponent = (props: WorkspacePanePanelProps) => ReactNode

const REPO_WORKSPACE_PANE_PANEL_BY_TYPE: Partial<Record<WorkspacePaneTabType, WorkspacePanePanelComponent>> = {
  status: StatusWorkspacePanePanel,
  changes: ChangesWorkspacePanePanel,
  history: HistoryWorkspacePanePanel,
  files: FilesWorkspacePanePanel,
  terminal: TerminalWorkspacePanePanel,
}

export function renderRepoWorkspacePanePanel(input: WorkspacePanePanelRenderInput): ReactNode {
  const Panel = REPO_WORKSPACE_PANE_PANEL_BY_TYPE[input.type]
  if (!Panel) return null
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
      repoInstanceId={repo.instanceId}
      terminalSyncReady={terminalSyncReady}
      branch={branch}
    />
  )
}

function FilesWorkspacePanePanel({ repo, detail, workspacePaneId, panelLabel }: WorkspacePanePanelProps) {
  const branch = detail.branch
  const worktreePath = branch?.worktree?.path
  if (!worktreePath) {
    return (
      <BranchTabPanel id={`${workspacePaneId}-files-panel`} {...panelLabel}>
        <FiletreeNoWorktreeView />
      </BranchTabPanel>
    )
  }
  return (
    <BranchTabPanel id={`${workspacePaneId}-files-panel`} {...panelLabel}>
      <FiletreeTab
        repoId={repo.id}
        repoInstanceId={repo.instanceId}
        branchName={branch.name}
        worktreePath={worktreePath}
      />
    </BranchTabPanel>
  )
}

function FiletreeTab({
  repoId,
  repoInstanceId,
  branchName,
  worktreePath,
}: {
  repoId: string
  repoInstanceId: string
  branchName: string
  worktreePath: string
}) {
  const t = useT()
  const navigation = usePrimaryWindowNavigation()
  const { createTerminal, createOwnedTerminal } = useTerminalSessionContext()
  const openTrashFileConfirm = useFiletreeActionDialogsStore((s) => s.openTrashFileConfirm)
  const interactionScopeKey = useMemo(() => filetreeInteractionScopeKey(repoId, worktreePath), [repoId, worktreePath])
  const selectedKeyList = useFiletreeInteractionStore(
    (s) => s.interactionByScope[interactionScopeKey]?.selectedKeys ?? emptyFiletreeInteractionSnapshot().selectedKeys,
  )
  const expandedKeyList = useFiletreeInteractionStore(
    (s) => s.interactionByScope[interactionScopeKey]?.expandedKeys ?? emptyFiletreeInteractionSnapshot().expandedKeys,
  )
  const result = useLazyRepoTree({ repoId, worktreePath, expandedKeys: expandedKeyList })
  const setSelectedKeys = useFiletreeInteractionStore((s) => s.setSelectedKeys)
  const setExpandedKey = useFiletreeInteractionStore((s) => s.setExpandedKey)
  const setTopVisibleRowIndex = useFiletreeInteractionStore((s) => s.setTopVisibleRowIndex)
  const pruneKeys = useFiletreeInteractionStore((s) => s.pruneKeys)
  const initialTopVisibleRowIndex = useMemo(
    () => useFiletreeInteractionStore.getState().interactionByScope[interactionScopeKey]?.topVisibleRowIndex ?? 0,
    [interactionScopeKey],
  )
  const selectedKeys = useMemo(() => new Set<Key>(selectedKeyList), [selectedKeyList])
  const expandedKeys = useMemo(() => new Set<Key>(expandedKeyList), [expandedKeyList])
  const scrollRestoreReady = useMemo(
    () => expandedKeyList.every((key) => result.loadedPrefixes.has(key) || result.errorKeys.has(key)),
    [expandedKeyList, result.errorKeys, result.loadedPrefixes],
  )
  const handleSelectedKeysChange = useCallback(
    (keys: Set<Key>) => {
      setSelectedKeys(interactionScopeKey, stringKeysFromReactAriaKeys(keys))
    },
    [interactionScopeKey, setSelectedKeys],
  )
  const handleDirectoryRowToggle = useCallback(
    (key: string, expanded: boolean) => {
      setExpandedKey(interactionScopeKey, key, expanded)
      if (expanded) {
        void result.loadChildren(key).catch((err) => {
          toast.error(t(err instanceof Error ? err.message : 'error.failed-read-repo'))
        })
      }
    },
    [interactionScopeKey, result.loadChildren, setExpandedKey, t],
  )
  const handlePruneKeys = useCallback(
    (validKeys: ReadonlySet<string>) => {
      pruneKeys(interactionScopeKey, validKeys, result.loadedPrefixes)
    },
    [interactionScopeKey, pruneKeys, result.loadedPrefixes],
  )
  const handleTopVisibleRowIndexChange = useCallback(
    (topVisibleRowIndex: number) => {
      setTopVisibleRowIndex(interactionScopeKey, topVisibleRowIndex)
    },
    [interactionScopeKey, setTopVisibleRowIndex],
  )

  const openFileInTerminal = useCallback(
    async (node: RepoTreeNode) => {
      if (node.kind !== 'file') return
      const openerIdentity = captureWorkspacePaneActiveTabIdentity(repoId)
      const viewerResult = await getRepositoryFileViewer(repoId, worktreePath).catch(() => ({
        viewer: 'cat' as const,
        shell: 'posix' as const,
      }))
      await runCreateTerminalTabCommand({
        base: { repoRoot: repoId, repoInstanceId, branch: branchName, worktreePath },
        createTerminal,
        createOwnedTerminal,
        openerIdentity,
        enterTerminalTab: () => navigation.showRepoWorkspacePaneTab(repoId, 'terminal'),
        options: {
          startupShellCommand: fileReadCommand(viewerResult, absoluteFilePathForTerminal(worktreePath, node.path)),
          insertAfterIdentity: openerIdentity,
        },
        t,
        logMessage: 'filetree open file terminal create failed',
      })
    },
    [branchName, createOwnedTerminal, createTerminal, navigation, repoId, repoInstanceId, t, worktreePath],
  )

  const requestTrashFile = useCallback(
    (node: RepoTreeNode) => {
      if (node.kind !== 'file') return
      openTrashFileConfirm({ repoId, worktreePath, path: node.path, name: node.name })
    },
    [openTrashFileConfirm, repoId, worktreePath],
  )

  return (
    <FiletreeView
      tree={result.tree}
      loading={result.loading}
      loadingKeys={result.loadingKeys}
      error={result.error}
      selectedKeys={selectedKeys}
      expandedKeys={expandedKeys}
      onSelectedKeysChange={handleSelectedKeysChange}
      onDirectoryRowToggle={handleDirectoryRowToggle}
      onPruneKeys={handlePruneKeys}
      initialTopVisibleRowIndex={initialTopVisibleRowIndex}
      scrollRestoreKey={interactionScopeKey}
      scrollRestoreReady={scrollRestoreReady}
      onTopVisibleRowIndexChange={handleTopVisibleRowIndexChange}
      onOpenFile={(node) => {
        void openFileInTerminal(node).catch((err) => {
          toast.error(t(err instanceof Error ? err.message : 'error.terminal-create-failed'))
        })
      }}
      onRequestTrashFile={requestTrashFile}
    />
  )
}

function stringKeysFromReactAriaKeys(keys: ReadonlySet<Key>): string[] {
  return Array.from(keys).filter((key): key is string => typeof key === 'string')
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
        <HistoryCommitGraphSkeleton rows={8} />
      ) : state.phase === 'error' ? (
        <EmptyState title={t(errorTitleKey)} />
      ) : state.entries.length === 0 ? (
        <EmptyState title={t('log.empty-for-branch', { branch: branchName })} />
      ) : (
        <ScrollPane>
          <HistoryCommitGraph repoId={repoId} entries={state.entries} />
        </ScrollPane>
      )}
    </BranchTabPanel>
  )
}

function BranchTerminalTab({
  workspacePaneId,
  panelLabel,
  repoId,
  repoInstanceId,
  terminalSyncReady,
  branch,
}: {
  workspacePaneId: string
  panelLabel: WorkspacePanePanelLabel
  repoId: string
  repoInstanceId: string
  terminalSyncReady: boolean
  branch: RepoWorkspaceBranch
}) {
  const { createTerminal, createOwnedTerminal } = useTerminalSessionContext()
  const t = useT()
  const createTerminalForSlot = useCallback(
    async (base: TerminalSessionBase) => {
      await runCreateTerminalTabCommand({
        base,
        createTerminal,
        createOwnedTerminal,
        openerIdentity: null,
        // No switch needed: this is the empty-state CTA rendered *inside*
        // the terminal tab itself (no worktree terminal exists yet), not a
        // "switch away from another tab" gesture.
        enterTerminalTab: () => {},
        t,
        logMessage: 'workspace pane terminal create failed',
      })
    },
    [createOwnedTerminal, createTerminal, t],
  )
  if (!branch.worktree?.path) return null
  return (
    <BranchTabPanel id={`${workspacePaneId}-terminal-panel`} {...panelLabel}>
      <TerminalSessionView
        repoRoot={repoId}
        repoInstanceId={repoInstanceId}
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
  branch: RepoWorkspaceBranch
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
