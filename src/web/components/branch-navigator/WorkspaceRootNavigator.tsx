import { useState, type ReactNode } from 'react'
import { FileText, FolderTree } from 'lucide-react'
import { ActionPopover, ActionPopoverItem } from '#/web/components/ActionPopover.tsx'
import {
  BRANCH_ROW_ACTION_BOX_CLASS,
  BRANCH_ROW_ACTION_SLOT_CLASS,
  BRANCH_ROW_CONTENT_CLASS,
  BRANCH_ROW_GRID_CLASS,
  BRANCH_ROW_LIST_CLASS,
} from '#/web/components/branch-navigator/branch-row-metrics.ts'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { cn } from '#/web/lib/cn.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useT } from '#/web/stores/i18n.ts'

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
  const [menuOpen, setMenuOpen] = useState(false)
  const name = useReposStore((state) => {
    const probe = state.repos[repoId]?.workspaceProbe
    return probe?.status === 'ready' ? probe.name : repoId
  })

  return (
    <ScrollArea className="h-full min-h-0 flex-1" data-testid="workspace-root-navigator">
      <ul className={BRANCH_ROW_LIST_CLASS}>
        <li
          data-testid="workspace-root-row"
          onClick={onSelect}
          onDoubleClick={onOpenStatus}
          className={cn(
            BRANCH_ROW_GRID_CLASS,
            'group relative cursor-pointer transition-colors duration-100',
            selected ? 'bg-selected text-selected-foreground hover:bg-selected' : 'hover:bg-muted',
          )}
        >
          <div className={cn(BRANCH_ROW_CONTENT_CLASS, 'pointer-events-none relative z-10 gap-2')}>
            <FolderTree size={16} className="shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-sm" title={name}>
              {name}
            </span>
          </div>
          <div className={cn(BRANCH_ROW_ACTION_SLOT_CLASS, 'pointer-events-none relative z-20')}>
            <div className={BRANCH_ROW_ACTION_BOX_CLASS}>
              <div
                className={cn(
                  'relative',
                  menuOpen
                    ? 'pointer-events-auto opacity-100'
                    : 'pointer-events-none opacity-0 transition-opacity duration-100 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100',
                )}
              >
                <ActionPopover label={t('action.menu')} open={menuOpen} onOpenChange={setMenuOpen}>
                  {({ close }) => (
                    <div className="space-y-0.5 p-1" role="list">
                      <WorkspaceAction label={t('tab.status')} icon={<FileText />} close={close} onSelect={onOpenStatus} />
                      <WorkspaceAction label={t('tab.files')} icon={<FolderTree />} close={close} onSelect={onOpenFiles} />
                    </div>
                  )}
                </ActionPopover>
              </div>
            </div>
          </div>
        </li>
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
