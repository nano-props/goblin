import { FolderTree } from 'lucide-react'
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Key } from 'react-aria-components'
import { toast } from 'sonner'
import { useT } from '#/web/stores/i18n.ts'
import { EmptyState, ScrollPane } from '#/web/components/Layout.tsx'
import { StatusList } from '#/web/components/StatusList.tsx'
import { useRepoLogQuery } from '#/web/repo-data-query.ts'
import { BranchStatus } from '#/web/components/repo-workspace/BranchStatus.tsx'
import { FiletreeNoWorktreeView, FiletreeView } from '#/web/components/repo-workspace/FiletreeView.tsx'
import { useLazyRepoTree } from '#/web/hooks/useLazyRepoTree.ts'
import type { RepoTreeNode } from '#/shared/api-types.ts'
import type { RepoWorkspaceRepo, CurrentRepoWorkspacePresentation } from '#/web/components/repo-workspace/model.ts'
import { DEFAULT_REPOSITORY_LOG_COUNT } from '#/shared/git-types.ts'
import type { WorkspacePaneStaticTabType, WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import { isWorkspacePaneRuntimeTabType, workspacePaneStaticTabId } from '#/shared/workspace-pane.ts'
import type {
  RepoWorkspaceRuntimeTabStateByType,
  RepoWorkspaceSelection,
} from '#/web/workspace-pane/repo-workspace-tab-model.ts'
import { useTerminalSessionContext } from '#/web/components/terminal/terminal-session-context.ts'
import { dispatchCreateTerminalWorkspacePaneRuntimeTabAction } from '#/web/workspace-pane/workspace-pane-runtime-tab-create-action.ts'
import type { WorkspacePanePanelLabel } from '#/web/workspace-pane/tab-providers.ts'
import { WorkspacePanePanelFrame } from '#/web/components/workspace-pane/WorkspacePanePanelFrame.tsx'
import { usePrimaryWindowNavigation } from '#/web/primary-window-navigation.tsx'
import { useFiletreeActionDialogsStore } from '#/web/stores/repos/filetree-action-dialogs.ts'
import {
  emptyFiletreeInteractionSnapshot,
  filetreeInteractionScopeKey,
  useFiletreeInteractionStore,
} from '#/web/stores/repos/filetree-interaction-state.ts'
import { getRepositoryFileViewer } from '#/web/filetree-client.ts'
import { absoluteFilePathForTerminal, fileReadCommand } from '#/web/components/repo-workspace/file-read-command.ts'
import { HistoryCommitGraph, HistoryCommitGraphSkeleton } from '#/web/components/repo-workspace/HistoryCommitGraph.tsx'
import { renderWorkspacePaneRuntimeTabPanel } from '#/web/workspace-pane/workspace-pane-runtime-tab-panel.tsx'
import { runtimeWorkspacePaneTarget } from '#/shared/workspace-pane-tabs-target.ts'
import type { WorkspacePaneFilesystemTarget } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import { workspacePaneFilesystemTerminalBase } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import { showCreatedWorkspacePaneFilesystemTerminal } from '#/web/workspace-pane/workspace-pane-filesystem-terminal.ts'

const DEFAULT_BRANCH_HISTORY_ERROR_KEY = 'error.failed-read-repo'

export interface WorkspacePanePanelRenderInput {
  type: WorkspacePaneTabType
  repo: Pick<RepoWorkspaceRepo, 'id' | 'repoRuntimeId' | 'branchModel' | 'ui' | 'workspaceProbe'> & {
    branchModel: RepoWorkspaceRepo['branchModel']
  }
  detail: CurrentRepoWorkspacePresentation
  workspacePaneId: string
  panelLabel: WorkspacePanePanelLabel
  selection: RepoWorkspaceSelection
  runtimeTabStateByType: RepoWorkspaceRuntimeTabStateByType
}

interface WorkspacePanePanelProps extends Omit<WorkspacePanePanelRenderInput, 'type' | 'selection'> {}

type RepoWorkspaceBranch = NonNullable<CurrentRepoWorkspacePresentation['branch']>
type WorkspacePaneStaticPanelComponent = (props: WorkspacePanePanelProps) => ReactNode

const REPO_WORKSPACE_STATIC_PANEL_BY_TYPE: Record<WorkspacePaneStaticTabType, WorkspacePaneStaticPanelComponent> = {
  status: StatusWorkspacePanePanel,
  changes: ChangesWorkspacePanePanel,
  history: HistoryWorkspacePanePanel,
  files: FilesWorkspacePanePanel,
}

export function renderRepoWorkspacePanePanel(input: WorkspacePanePanelRenderInput): ReactNode {
  const { type, selection, ...panelProps } = input
  if (isWorkspacePaneRuntimeTabType(type)) {
    const runtimeState = input.runtimeTabStateByType[type]
    const branchName = input.detail.branch?.name ?? ''
    const worktreePath = input.detail.branch?.worktree?.path ?? null
    const runtimeTarget = runtimeWorkspacePaneTarget(
      { repoRoot: input.repo.id, branchName, worktreePath },
      input.repo.repoRuntimeId,
    )
    if (!runtimeTarget || !worktreePath) return null
    return renderWorkspacePaneRuntimeTabPanel({
      type,
      workspacePaneId: input.workspacePaneId,
      panelLabel: input.panelLabel,
      selectedSessionId: selectedRuntimeSessionId(selection, type),
      target: {
        runtimeTarget,
        presentation: { kind: 'git-worktree', branchName },
        worktreePath,
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

function selectedRuntimeSessionId(selection: RepoWorkspaceSelection, type: WorkspacePaneTabType): string | null {
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
        <BranchStatus detail={detail} repoRuntimeId={repo.repoRuntimeId} />
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
      repoRuntimeId={repo.repoRuntimeId}
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
  const capabilities = repo.workspaceProbe.status === 'ready' ? repo.workspaceProbe.capabilities : null
  if (!worktreePath || !capabilities) {
    return (
      <WorkspacePanePanelFrame id={`${workspacePaneId}-files-panel`} {...panelLabel}>
        <FiletreeNoWorktreeView />
      </WorkspacePanePanelFrame>
    )
  }
  return (
    <WorkspacePanePanelFrame id={`${workspacePaneId}-files-panel`} {...panelLabel}>
      <FiletreeTab
        target={{
          kind: 'git-worktree',
          workspaceId: repo.id,
          workspaceRuntimeId: repo.repoRuntimeId,
          branchName: branch.name,
          rootPath: worktreePath,
          capabilities,
        }}
      />
    </WorkspacePanePanelFrame>
  )
}

export function FiletreeTab({
  target,
}: {
  target: WorkspacePaneFilesystemTarget
}) {
  const repoId = target.workspaceId
  const repoRuntimeId = target.workspaceRuntimeId
  const worktreePath = target.rootPath
  const t = useT()
  const navigation = usePrimaryWindowNavigation()
  const { createTerminalWithAdmission } = useTerminalSessionContext()
  const openTrashFileConfirm = useFiletreeActionDialogsStore((s) => s.openTrashFileConfirm)
  const interactionScopeKey = useMemo(() => filetreeInteractionScopeKey(repoId, worktreePath), [repoId, worktreePath])
  const selectedKeyList = useFiletreeInteractionStore(
    (s) => s.interactionByScope[interactionScopeKey]?.selectedKeys ?? emptyFiletreeInteractionSnapshot().selectedKeys,
  )
  const expandedKeyList = useFiletreeInteractionStore(
    (s) => s.interactionByScope[interactionScopeKey]?.expandedKeys ?? emptyFiletreeInteractionSnapshot().expandedKeys,
  )
  const result = useLazyRepoTree({ repoId, repoRuntimeId, worktreePath, expandedKeys: expandedKeyList })
  const setSelectedKeys = useFiletreeInteractionStore((s) => s.setSelectedKeys)
  const setExpandedKey = useFiletreeInteractionStore((s) => s.setExpandedKey)
  const setTopVisibleRowIndex = useFiletreeInteractionStore((s) => s.setTopVisibleRowIndex)
  const pruneKeys = useFiletreeInteractionStore((s) => s.pruneKeys)
  const initialTopVisibleRowIndex = useMemo(
    () => useFiletreeInteractionStore.getState().interactionByScope[interactionScopeKey]?.topVisibleRowIndex ?? 0,
    [interactionScopeKey],
  )
  const {
    pendingKeys: pendingOpeningFileKeys,
    beginPending: beginOpeningFile,
    endPending: endOpeningFile,
  } = usePendingKeySet()
  const openingFileKeyPrefix = useMemo(() => `${interactionScopeKey}\0`, [interactionScopeKey])
  const openingFileKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const key of pendingOpeningFileKeys) {
      if (key.startsWith(openingFileKeyPrefix)) keys.add(key.slice(openingFileKeyPrefix.length))
    }
    return keys
  }, [openingFileKeyPrefix, pendingOpeningFileKeys])
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
      const openingFileKey = `${openingFileKeyPrefix}${node.id}`
      if (!beginOpeningFile(openingFileKey)) return
      try {
        const openerIdentity = workspacePaneStaticTabId('files')
        const base = workspacePaneFilesystemTerminalBase(target)
        if (!base) throw new Error('error.workspace-tabs-target-invalid')
        await dispatchCreateTerminalWorkspacePaneRuntimeTabAction({
          base,
          createTerminal: createTerminalWithAdmission,
          openerIdentity,
          showCreatedTerminalTab: (terminalSessionId, canonicalBranch) =>
            showCreatedWorkspacePaneFilesystemTerminal(target, terminalSessionId, canonicalBranch, navigation),
          insertAfterIdentity: openerIdentity,
          options: {
            resolveStartupShellCommand: async () => {
              const viewerResult = await getRepositoryFileViewer(repoId, worktreePath, { repoRuntimeId })
              return fileReadCommand(viewerResult, absoluteFilePathForTerminal(viewerResult.executionRoot, node.path))
            },
          },
          t,
          logMessage: 'filetree open file terminal create failed',
        })
      } finally {
        endOpeningFile(openingFileKey)
      }
    },
    [
      beginOpeningFile,
      createTerminalWithAdmission,
      endOpeningFile,
      openingFileKeyPrefix,
      navigation,
      repoId,
      repoRuntimeId,
      t,
      worktreePath,
      target,
    ],
  )

  const requestTrashFile = useCallback(
    (node: RepoTreeNode) => {
      if (node.kind !== 'file') return
      openTrashFileConfirm({ repoId, repoRuntimeId, worktreePath, path: node.path, name: node.name })
    },
    [openTrashFileConfirm, repoId, repoRuntimeId, worktreePath],
  )

  return (
    <FiletreeView
      tree={result.tree}
      loading={result.loading}
      loadingKeys={result.loadingKeys}
      openingFileKeys={openingFileKeys}
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
      onOpenFile={
        target.capabilities.terminal.available
          ? (node) => {
              void openFileInTerminal(node).catch((err) => {
                toast.error(t(err instanceof Error ? err.message : 'error.terminal-create-failed'))
              })
            }
          : undefined
      }
      onRequestTrashFile={target.capabilities.files.write ? requestTrashFile : undefined}
    />
  )
}

function stringKeysFromReactAriaKeys(keys: ReadonlySet<Key>): string[] {
  return Array.from(keys).filter((key): key is string => typeof key === 'string')
}

function usePendingKeySet() {
  const pendingKeysRef = useRef<ReadonlySet<string>>(new Set())
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(() => new Set())

  const beginPending = useCallback((key: string): boolean => {
    if (pendingKeysRef.current.has(key)) return false
    const next = new Set(pendingKeysRef.current)
    next.add(key)
    pendingKeysRef.current = next
    setPendingKeys(next)
    return true
  }, [])

  const endPending = useCallback((key: string): void => {
    if (!pendingKeysRef.current.has(key)) return
    const next = new Set(pendingKeysRef.current)
    next.delete(key)
    pendingKeysRef.current = next
    setPendingKeys(next)
  }, [])

  return { pendingKeys, beginPending, endPending }
}

function BranchHistoryTab({
  repoId,
  repoRuntimeId,
  branchName,
  workspacePaneId,
  panelLabel,
}: {
  repoId: string
  repoRuntimeId: string
  branchName: string
  workspacePaneId: string
  panelLabel: WorkspacePanePanelLabel
}) {
  const t = useT()
  const historyQuery = useRepoLogQuery(repoId, repoRuntimeId, branchName, {
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
          <HistoryCommitGraph repoId={repoId} repoRuntimeId={repoRuntimeId} entries={entries} />
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
  branch: RepoWorkspaceBranch
  currentBranchStatus: CurrentRepoWorkspacePresentation['currentBranchStatus']
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
