import { useState, type ReactNode } from 'react'
import { FileText, FolderTree } from 'lucide-react'
import { ActionPopover, ActionPopoverItem } from '#/web/components/ActionPopover.tsx'
import {
  BRANCH_ROW_ACTION_BOX_CLASS,
  BRANCH_ROW_LIST_CLASS,
} from '#/web/components/branch-navigator/branch-row-metrics.ts'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { cn } from '#/web/lib/cn.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useT } from '#/web/stores/i18n.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { NavigatorRow } from '#/web/components/branch-navigator/NavigatorRow.tsx'
import { formatWorkspaceDisplayLocation } from '#/web/lib/paths.ts'

interface WorkspaceRootNavigatorProps {
  repoId: string
  selected: boolean
  onSelect?: () => void
  onOpenStatus?: () => void
  onOpenFiles?: () => void
}

/** The non-Git workspace root is a first-class navigation target, not a synthetic branch. */
export function WorkspaceRootNavigator({
  repoId,
  selected,
  onSelect,
  onOpenStatus,
  onOpenFiles,
}: WorkspaceRootNavigatorProps) {
  const t = useT()
  const compact = useIsCompactUi()
  const [menuOpen, setMenuOpen] = useState(false)
  const actionVisible = compact || menuOpen
  const name = useReposStore((state) => {
    const probe = state.repos[repoId]?.workspaceProbe
    return probe?.status === 'ready' ? probe.name : formatWorkspaceDisplayLocation(repoId)
  })

  return (
    <ScrollArea className="h-full min-h-0 flex-1" data-testid="workspace-root-navigator">
      <ul className={BRANCH_ROW_LIST_CLASS}>
        <NavigatorRow
          data-testid="workspace-root-row"
          selected={selected}
          onClick={onSelect}
          onDoubleClick={onOpenStatus}
          contentClassName="gap-2"
          content={
            <>
              <FolderTree size={16} className="shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-sm" title={name}>
                {name}
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
                        onSelect={onOpenStatus}
                      />
                      <WorkspaceAction
                        label={t('tab.files')}
                        icon={<FolderTree />}
                        close={close}
                        onSelect={onOpenFiles}
                      />
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
