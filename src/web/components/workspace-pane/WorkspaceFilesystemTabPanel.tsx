import { computed, defineComponent, shallowRef } from 'vue'
import type { FunctionalComponent, ShallowRef } from 'vue'
import { toast } from 'vue-sonner'
import type { WorkspaceFilesystemNode } from '#/shared/api-types.ts'
import { workspacePaneStaticTabId } from '#/shared/workspace-pane.ts'
import { workspacePaneFilesystemExecutionTargetKey } from '#/shared/workspace-runtime.ts'
import type { WorkspacePaneFilesystemExecutionTarget } from '#/shared/workspace-runtime.ts'
import { useAppNavigation } from '#/web/app-navigation.tsx'
import { useTerminalSessionContext } from '#/web/components/terminal/terminal-session-context.ts'
import { FiletreeView } from '#/web/components/workspace-pane/FiletreeView.tsx'
import { absoluteFilePathForTerminal, fileReadCommand } from '#/web/components/workspace-pane/file-read-command.ts'
import { downloadWorkspaceFile } from '#/web/file-download.ts'
import { useWorkspaceFilesystemTree } from '#/web/hooks/useWorkspaceFilesystemTree.ts'
import { useStoreSelector } from '#/web/stores/store-selector.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import { filetreeActionDialogsStore } from '#/web/stores/workspaces/filetree-action-dialogs.ts'
import {
  emptyFiletreeInteractionSnapshot,
  filetreeInteractionScopeKey,
  filetreeInteractionStore,
} from '#/web/stores/workspaces/filetree-interaction-state.ts'
import { getWorkspaceFileViewer } from '#/web/workspace-filesystem-client.ts'
import {
  workspacePaneFilesystemRootPath,
  workspacePaneFilesystemRuntimeTarget,
  workspacePaneFilesystemTerminalBase,
} from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import type { WorkspacePaneFilesystemTarget } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import { showCreatedWorkspacePaneFilesystemTerminal } from '#/web/workspace-pane/workspace-pane-filesystem-terminal.ts'
import { dispatchCreateTerminalWorkspacePaneRuntimeTabAction } from '#/web/workspace-pane/workspace-pane-runtime-tab-create-action.ts'

interface WorkspaceFilesystemTabPanelProps {
  target: WorkspacePaneFilesystemTarget
}

export const WorkspaceFilesystemTabPanel: FunctionalComponent<WorkspaceFilesystemTabPanelProps> = (props) => {
  const executionTarget = workspacePaneFilesystemRuntimeTarget(props.target)
  return (
    <ExecutionTargetFilesystemTabPanel
      key={workspacePaneFilesystemExecutionTargetKey(executionTarget)}
      target={props.target}
      executionTarget={executionTarget}
    />
  )
}

WorkspaceFilesystemTabPanel.props = ['target']

interface ExecutionTargetFilesystemTabPanelProps extends WorkspaceFilesystemTabPanelProps {
  executionTarget: WorkspacePaneFilesystemExecutionTarget
}

const ExecutionTargetFilesystemTabPanel = defineComponent<ExecutionTargetFilesystemTabPanelProps>({
  name: 'ExecutionTargetFilesystemTabPanel',
  props: ['target', 'executionTarget'],

  setup(props) {
    const t = useT()
    const navigation = useAppNavigation()
    const { createTerminalWithAdmission, focusTerminal } = useTerminalSessionContext()
    const { openTrashFileConfirm } = filetreeActionDialogsStore.getState()
    const rootPath = workspacePaneFilesystemRootPath(props.target)
    const interactionScopeKey = filetreeInteractionScopeKey(props.target.workspaceId, rootPath)
    const interactionByScope = useStoreSelector(filetreeInteractionStore, (state) => state.interactionByScope)
    const interactionSnapshot = computed(
      () => interactionByScope.value[interactionScopeKey] ?? emptyFiletreeInteractionSnapshot(),
    )
    const selectedKeys = computed(() => new Set(interactionSnapshot.value.selectedKeys))
    const expandedKeys = computed(() => new Set(interactionSnapshot.value.expandedKeys))
    const result = useWorkspaceFilesystemTree({
      target: props.executionTarget,
      expandedKeys: () => interactionSnapshot.value.expandedKeys,
    })
    const { setSelectedKeys, setExpandedKey, setTopVisibleRowIndex, pruneKeys } = filetreeInteractionStore.getState()
    const initialTopVisibleRowIndex = interactionSnapshot.value.topVisibleRowIndex
    const pendingOpeningFileKeys = usePendingKeySet()
    const openingFileKeyPrefix = `${interactionScopeKey}\0`
    const openingFileKeys = computed(() => {
      const keys = new Set<string>()
      for (const key of pendingOpeningFileKeys.pendingKeys.value) {
        if (key.startsWith(openingFileKeyPrefix)) keys.add(key.slice(openingFileKeyPrefix.length))
      }
      return keys
    })

    function changeSelectedKeys(keys: Set<string>): void {
      setSelectedKeys(interactionScopeKey, Array.from(keys))
    }

    function toggleDirectory(key: string, expanded: boolean): void {
      setExpandedKey(interactionScopeKey, key, expanded)
      if (!expanded) return
      void result.loadChildren(key).catch((error) => {
        const errorMessageKey = error instanceof Error ? error.message : 'dashboard.directory.read-failed'
        toast.error(t(errorMessageKey))
      })
    }

    function pruneInteractionKeys(validKeys: ReadonlySet<string>): void {
      pruneKeys(interactionScopeKey, validKeys, result.loadedPrefixes)
    }

    function updateTopVisibleRowIndex(topVisibleRowIndex: number): void {
      setTopVisibleRowIndex(interactionScopeKey, topVisibleRowIndex)
    }

    async function openFileInTerminal(node: WorkspaceFilesystemNode): Promise<void> {
      if (node.kind !== 'file') return
      const openingFileKey = `${openingFileKeyPrefix}${node.id}`
      if (!pendingOpeningFileKeys.beginPending(openingFileKey)) return
      try {
        const target = props.target
        const executionTarget = props.executionTarget
        const openerIdentity = workspacePaneStaticTabId('files')
        const base = workspacePaneFilesystemTerminalBase(target)
        if (!base) throw new Error('error.workspace-tabs-target-invalid')
        await dispatchCreateTerminalWorkspacePaneRuntimeTabAction({
          base,
          createTerminal: createTerminalWithAdmission,
          openerIdentity,
          showCreatedTerminalTab: (terminalSessionId, canonicalBranch, routeRequest) =>
            showCreatedWorkspacePaneFilesystemTerminal(
              target,
              terminalSessionId,
              canonicalBranch,
              navigation,
              routeRequest,
            ),
          focusTerminal,
          insertAfterIdentity: openerIdentity,
          options: {
            resolveStartupShellCommand: async () => {
              const viewerResult = await getWorkspaceFileViewer(executionTarget, {})
              return fileReadCommand(viewerResult, absoluteFilePathForTerminal(viewerResult.executionRoot, node.path))
            },
          },
          t,
          logMessage: 'filetree open file terminal create failed',
        })
      } finally {
        pendingOpeningFileKeys.endPending(openingFileKey)
      }
    }

    function requestTrashFile(node: WorkspaceFilesystemNode): void {
      if (node.kind !== 'file') return
      openTrashFileConfirm({ target: props.executionTarget, path: node.path, name: node.name })
    }

    return () => (
      <FiletreeView
        tree={result.tree}
        isInitialLoading={result.isInitialLoading}
        isReading={result.isReading}
        loadingKeys={result.loadingKeys}
        openingFileKeys={openingFileKeys.value}
        error={result.error}
        selectedKeys={selectedKeys.value}
        expandedKeys={expandedKeys.value}
        onSelectedKeysChange={changeSelectedKeys}
        onDirectoryRowToggle={toggleDirectory}
        onPruneKeys={pruneInteractionKeys}
        onRetry={result.refresh}
        initialTopVisibleRowIndex={initialTopVisibleRowIndex}
        scrollRestoreKey={interactionScopeKey}
        scrollRestoreReady={result.expandedDirectoryReadsSettled}
        onTopVisibleRowIndexChange={updateTopVisibleRowIndex}
        onOpenFile={
          props.target.capabilities.terminal.available
            ? (node) => {
                void openFileInTerminal(node).catch((error) => {
                  const errorMessageKey = error instanceof Error ? error.message : 'error.terminal-create-failed'
                  toast.error(t(errorMessageKey))
                })
              }
            : undefined
        }
        onDownloadFile={(node) => {
          if (node.kind === 'file') downloadWorkspaceFile(props.executionTarget, node.path)
        }}
        onRequestTrashFile={props.target.capabilities.files.write ? requestTrashFile : undefined}
      />
    )
  },
})

function usePendingKeySet(): {
  pendingKeys: Readonly<ShallowRef<ReadonlySet<string>>>
  beginPending: (key: string) => boolean
  endPending: (key: string) => void
} {
  const pendingKeys = shallowRef<ReadonlySet<string>>(new Set())

  function beginPending(key: string): boolean {
    if (pendingKeys.value.has(key)) return false
    pendingKeys.value = new Set(pendingKeys.value).add(key)
    return true
  }

  function endPending(key: string): void {
    if (!pendingKeys.value.has(key)) return
    const next = new Set(pendingKeys.value)
    next.delete(key)
    pendingKeys.value = next
  }

  return { pendingKeys, beginPending, endPending }
}
