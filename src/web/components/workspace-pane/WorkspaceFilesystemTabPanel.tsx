import { useCallback, useMemo, useRef, useState } from 'react'
import type { Key } from 'react-aria-components'
import { toast } from 'sonner'
import type { WorkspaceFilesystemNode } from '#/shared/api-types.ts'
import { workspacePaneStaticTabId } from '#/shared/workspace-pane.ts'
import { FiletreeView } from '#/web/components/workspace-pane/FiletreeView.tsx'
import { absoluteFilePathForTerminal, fileReadCommand } from '#/web/components/workspace-pane/file-read-command.ts'
import { useTerminalSessionContext } from '#/web/components/terminal/terminal-session-context.ts'
import { useWorkspaceFilesystemTree } from '#/web/hooks/useWorkspaceFilesystemTree.ts'
import { usePrimaryWindowNavigation } from '#/web/primary-window-navigation.tsx'
import { useT } from '#/web/stores/i18n.ts'
import { useFiletreeActionDialogsStore } from '#/web/stores/workspaces/filetree-action-dialogs.ts'
import {
  emptyFiletreeInteractionSnapshot,
  filetreeInteractionScopeKey,
  useFiletreeInteractionStore,
} from '#/web/stores/workspaces/filetree-interaction-state.ts'
import { getWorkspaceFileViewer } from '#/web/workspace-filesystem-client.ts'
import { dispatchCreateTerminalWorkspacePaneRuntimeTabAction } from '#/web/workspace-pane/workspace-pane-runtime-tab-create-action.ts'
import type { WorkspacePaneFilesystemTarget } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import {
  workspacePaneFilesystemRuntimeTarget,
  workspacePaneFilesystemRootPath,
  workspacePaneFilesystemTerminalBase,
} from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import { showCreatedWorkspacePaneFilesystemTerminal } from '#/web/workspace-pane/workspace-pane-filesystem-terminal.ts'
import type { WorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'

export function WorkspaceFilesystemTabPanel({
  routeTarget,
  target,
}: {
  routeTarget: WorkspacePaneTabsTarget
  target: WorkspacePaneFilesystemTarget
}) {
  const workspaceId = target.workspaceId
  const workspaceRuntimeId = target.workspaceRuntimeId
  const rootPath = workspacePaneFilesystemRootPath(target)
  const executionTarget = useMemo(
    () => workspacePaneFilesystemRuntimeTarget(target),
    [rootPath, target.kind, workspaceId, workspaceRuntimeId],
  )
  const t = useT()
  const navigation = usePrimaryWindowNavigation()
  const { createTerminalWithAdmission, focusTerminal } = useTerminalSessionContext()
  const openTrashFileConfirm = useFiletreeActionDialogsStore((state) => state.openTrashFileConfirm)
  const interactionScopeKey = useMemo(() => filetreeInteractionScopeKey(workspaceId, rootPath), [rootPath, workspaceId])
  const selectedKeyList = useFiletreeInteractionStore(
    (state) =>
      state.interactionByScope[interactionScopeKey]?.selectedKeys ?? emptyFiletreeInteractionSnapshot().selectedKeys,
  )
  const expandedKeyList = useFiletreeInteractionStore(
    (state) =>
      state.interactionByScope[interactionScopeKey]?.expandedKeys ?? emptyFiletreeInteractionSnapshot().expandedKeys,
  )
  const result = useWorkspaceFilesystemTree({ target: executionTarget, expandedKeys: expandedKeyList })
  const setSelectedKeys = useFiletreeInteractionStore((state) => state.setSelectedKeys)
  const setExpandedKey = useFiletreeInteractionStore((state) => state.setExpandedKey)
  const setTopVisibleRowIndex = useFiletreeInteractionStore((state) => state.setTopVisibleRowIndex)
  const pruneKeys = useFiletreeInteractionStore((state) => state.pruneKeys)
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
      if (!expanded) return
      void result.loadChildren(key).catch((error) => {
        const errorKey = error instanceof Error ? error.message : 'dashboard.directory.read-failed'
        toast.error(t(errorKey))
      })
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
    async (node: WorkspaceFilesystemNode) => {
      if (node.kind !== 'file') return
      const openingFileKey = `${openingFileKeyPrefix}${node.id}`
      if (!beginOpeningFile(openingFileKey)) return
      try {
        const openerIdentity = workspacePaneStaticTabId('files')
        const base = workspacePaneFilesystemTerminalBase(target)
        if (!base) throw new Error('error.workspace-tabs-target-invalid')
        await dispatchCreateTerminalWorkspacePaneRuntimeTabAction({
          routeTarget,
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
        endOpeningFile(openingFileKey)
      }
    },
    [
      beginOpeningFile,
      createTerminalWithAdmission,
      endOpeningFile,
      executionTarget,
      focusTerminal,
      navigation,
      openingFileKeyPrefix,
      routeTarget,
      t,
      target,
    ],
  )
  const requestTrashFile = useCallback(
    (node: WorkspaceFilesystemNode) => {
      if (node.kind !== 'file') return
      openTrashFileConfirm({ target: executionTarget, path: node.path, name: node.name })
    },
    [executionTarget, openTrashFileConfirm],
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
              void openFileInTerminal(node).catch((error) => {
                const errorKey = error instanceof Error ? error.message : 'error.terminal-create-failed'
                toast.error(t(errorKey))
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
