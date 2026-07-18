import { useState, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { FileText, FolderTree, Terminal } from 'lucide-react'
import { ActionPopover, ActionPopoverItem } from '#/web/components/ActionPopover.tsx'
import {
  BRANCH_ROW_ACTION_BOX_CLASS,
  BRANCH_ROW_LIST_CLASS,
} from '#/web/components/branch-navigator/branch-row-metrics.ts'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { cn } from '#/web/lib/cn.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { useT } from '#/web/stores/i18n.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { NavigatorRow } from '#/web/components/branch-navigator/NavigatorRow.tsx'
import { formatWorkspaceDisplayLocation } from '#/web/lib/paths.ts'
import { usePrimaryWindowNavigation } from '#/web/primary-window-navigation.tsx'
import {
  runShowWorkspacePaneTabCommand,
  runTerminalPrimaryActionCommand,
} from '#/web/commands/workspace-commands.ts'
import { workspaceTerminalAvailable } from '#/shared/workspace-runtime.ts'
import { parseCanonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'

interface WorkspaceRootNavigatorProps {
  workspaceId: string
  selected: boolean
  onSelect?: () => void
}

/** The non-Git workspace root is a first-class navigation target, not a synthetic branch. */
export function WorkspaceRootNavigator({
  workspaceId,
  selected,
  onSelect,
}: WorkspaceRootNavigatorProps) {
  const t = useT()
  const navigation = usePrimaryWindowNavigation()
  const compact = useIsCompactUi()
  const [menuOpen, setMenuOpen] = useState(false)
  const actionVisible = compact || menuOpen
  const workspace = useWorkspacesStore(
    useShallow((state) => {
      const probe = state.workspaces[workspaceId]?.workspaceProbe
      const repo = state.workspaces[workspaceId]
      return {
        name: probe?.status === 'ready' ? probe.name : formatWorkspaceDisplayLocation(workspaceId),
        terminalAvailable: workspaceTerminalAvailable(probe),
        workspaceRuntimeId: repo?.workspaceRuntimeId ?? null,
        capabilities: probe?.status === 'ready' ? probe.capabilities : null,
      }
    }),
  )
  const root = parseCanonicalWorkspaceLocator(workspaceId)
  const filesystemTarget =
    root && workspace.workspaceRuntimeId && workspace.capabilities
      ? {
          kind: 'workspace-root' as const,
          workspaceId,
          workspaceRuntimeId: workspace.workspaceRuntimeId,
          rootPath: root.path,
          capabilities: workspace.capabilities,
        }
      : null
  const commandTarget = filesystemTarget
    ? { kind: 'workspace-root' as const, workspacePaneRoute: null, filesystemTarget }
    : null

  const showStaticTab = (tab: 'status' | 'files') => {
    if (!commandTarget) return
    void runShowWorkspacePaneTabCommand({ workspaceId, target: commandTarget, tab, navigation })
  }

  return (
    <ScrollArea className="h-full min-h-0 flex-1" data-testid="workspace-root-navigator">
      <ul className={BRANCH_ROW_LIST_CLASS}>
        <NavigatorRow
          data-testid="workspace-root-row"
          selected={selected}
          onClick={onSelect}
          onDoubleClick={commandTarget ? () => showStaticTab('status') : undefined}
          contentClassName="gap-2"
          content={
            <>
              <FolderTree size={16} className="shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-sm" title={workspace.name}>
                {workspace.name}
              </span>
            </>
          }
          actions={
            <div className={BRANCH_ROW_ACTION_BOX_CLASS}>
              <div
                className={cn(
                  'relative',
                  actionVisible && 'pointer-events-auto opacity-100',
                  !actionVisible &&
                    'pointer-events-none opacity-0 transition-opacity duration-100 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100',
                )}
              >
                <ActionPopover label={t('action.menu')} open={menuOpen} onOpenChange={setMenuOpen}>
                  {({ close }) => (
                    <div className="space-y-0.5 p-1" role="list">
                      <WorkspaceAction
                        label={t('tab.status')}
                        icon={<FileText />}
                        close={close}
                        onSelect={commandTarget ? () => showStaticTab('status') : undefined}
                      />
                      <WorkspaceAction
                        label={t('tab.files')}
                        icon={<FolderTree />}
                        close={close}
                        onSelect={commandTarget ? () => showStaticTab('files') : undefined}
                      />
                      {workspace.terminalAvailable && commandTarget && (
                        <WorkspaceAction
                          label={t('tab.terminal')}
                          icon={<Terminal />}
                          close={close}
                          onSelect={() => {
                            void runTerminalPrimaryActionCommand({
                              workspaceId,
                              target: commandTarget,
                              navigation,
                              t,
                            })
                          }}
                        />
                      )}
                    </div>
                  )}
                </ActionPopover>
              </div>
            </div>
          }
        />
      </ul>
    </ScrollArea>
  )
}

function WorkspaceAction({
  label,
  icon,
  close,
  onSelect,
}: {
  label: string
  icon: ReactNode
  close: () => void
  onSelect?: () => void
}) {
  return (
    <div role="listitem">
      <ActionPopoverItem
        label={label}
        icon={icon}
        disabled={!onSelect}
        onSelect={() => {
          close()
          onSelect?.()
        }}
      />
    </div>
  )
}
