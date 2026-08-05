import { useState, type KeyboardEvent, type MouseEvent } from 'react'
import { ChevronRight, Download, File, FileTerminal, Folder, Loader2, Trash2 } from 'lucide-react'
import type { WorkspaceFilesystemNode } from '#/shared/api-types.ts'
import { ActionPopover, ActionPopoverItem } from '#/web/components/ActionPopover.tsx'
import type { FiletreeRow } from '#/web/components/workspace-pane/filetree-collection.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { cn } from '#/web/lib/cn.ts'
import { useT } from '#/web/stores/i18n.ts'

const FILETREE_ROW_I18N_KEYS = {
  open: 'app-chrome.open',
  download: 'filetree.download',
  delete: 'menu.edit.delete',
  actionMenu: 'action.menu',
} as const satisfies Record<string, string>

export function FiletreeTreeRow({
  row,
  rowIndex,
  hasChildItems,
  isExpanded,
  isSelected,
  isTabbable,
  isLoading,
  isOpeningFile,
  virtualStart,
  onKeyDown,
  onRowClick,
  onToggleDirectory,
  onSelect,
  onOpenFile,
  onDownloadFile,
  onRequestTrashFile,
}: {
  readonly row: FiletreeRow
  readonly rowIndex: number
  readonly hasChildItems: boolean
  readonly isExpanded: boolean
  readonly isSelected: boolean
  readonly isTabbable: boolean
  readonly isLoading: boolean
  readonly isOpeningFile: boolean
  readonly virtualStart: number
  readonly onKeyDown: (node: WorkspaceFilesystemNode, event: KeyboardEvent<HTMLDivElement>) => void
  readonly onRowClick: (node: WorkspaceFilesystemNode, isExpanded: boolean) => void
  readonly onToggleDirectory: (key: string, expanded: boolean) => void
  readonly onSelect: (node: WorkspaceFilesystemNode) => void
  readonly onOpenFile?: (node: WorkspaceFilesystemNode) => void
  readonly onDownloadFile?: (node: WorkspaceFilesystemNode) => void
  readonly onRequestTrashFile?: (node: WorkspaceFilesystemNode) => void
}) {
  const { node, level } = row
  const isDirectory = node.kind === 'directory'

  return (
    <div
      role="treeitem"
      aria-label={node.name}
      aria-level={level}
      aria-posinset={row.posInSet}
      aria-setsize={row.setSize}
      aria-selected={isSelected}
      aria-expanded={isDirectory ? isExpanded : undefined}
      tabIndex={isTabbable ? 0 : -1}
      data-filetree-row=""
      data-filetree-row-index={rowIndex}
      className={cn(
        'group/filetree-row absolute left-0 top-0 w-full cursor-pointer text-foreground outline-none transition-colors duration-100',
        !isSelected && 'hover:bg-muted focus:bg-muted active:bg-muted',
        isSelected && 'bg-selected text-selected-foreground',
        'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
      )}
      style={{
        transform: `translateY(${virtualStart}px)`,
      }}
      onClick={(event) => handleTreeItemClick(event, node, isExpanded, onRowClick)}
      onDoubleClick={onOpenFile ? (event) => handleItemDoubleClick(event, node, onOpenFile) : undefined}
      onKeyDown={(event) => onKeyDown(node, event)}
    >
      <div
        className="flex w-full min-w-0 items-center gap-1 py-0.5 pl-1.5 pr-3"
        style={{ paddingLeft: `${(level - 1) * 12 + 6}px` }}
      >
        <span className="flex w-3 shrink-0 items-center justify-center text-muted-foreground">
          {hasChildItems ? (
            <button
              type="button"
              slot="chevron"
              className="flex size-3 items-center justify-center rounded-sm outline-none"
              onClick={(event) => {
                event.stopPropagation()
                onToggleDirectory(node.id, !isExpanded)
              }}
              aria-label={node.name}
            >
              {isLoading ? (
                <Loader2 size={11} aria-hidden className="animate-spin" />
              ) : (
                <ChevronRight
                  size={12}
                  aria-hidden
                  className={cn('transition-transform', isExpanded ? 'rotate-90' : 'rotate-0')}
                />
              )}
            </button>
          ) : null}
        </span>
        <span className="flex w-3.5 shrink-0 items-center justify-center text-muted-foreground">
          {isDirectory ? <Folder size={12} aria-hidden /> : <File size={12} aria-hidden />}
        </span>
        <span className="min-w-0 flex-1 truncate text-current">{node.name}</span>
        {!isDirectory && (onOpenFile || onDownloadFile || onRequestTrashFile) ? (
          <FiletreeActionMenu
            node={node}
            busy={isOpeningFile}
            onOpenFile={
              onOpenFile
                ? (target) => {
                    onSelect(target)
                    onOpenFile(target)
                  }
                : undefined
            }
            onDownloadFile={onDownloadFile}
            onRequestTrashFile={onRequestTrashFile}
          />
        ) : null}
      </div>
    </div>
  )
}

function handleTreeItemClick(
  event: MouseEvent<Element>,
  node: WorkspaceFilesystemNode,
  isExpanded: boolean,
  onRowClick: (node: WorkspaceFilesystemNode, isExpanded: boolean) => void,
) {
  if (event.target instanceof Element && isFiletreeRowControl(event.target)) return
  onRowClick(node, isExpanded)
}

function isFiletreeRowControl(target: Element): boolean {
  return target.closest('[data-action-popover-trigger], button[slot="chevron"]') !== null
}

function handleItemDoubleClick(
  event: MouseEvent<HTMLElement>,
  node: WorkspaceFilesystemNode,
  onOpenFile: (node: WorkspaceFilesystemNode) => void,
): void {
  if (node.kind !== 'file') return
  if ((event.target as HTMLElement | null)?.closest('[data-action-popover-trigger]')) return
  onOpenFile(node)
}

function FiletreeActionMenu({
  node,
  busy,
  onOpenFile,
  onDownloadFile,
  onRequestTrashFile,
}: {
  readonly node: WorkspaceFilesystemNode
  readonly busy: boolean
  readonly onOpenFile?: (node: WorkspaceFilesystemNode) => void
  readonly onDownloadFile?: (node: WorkspaceFilesystemNode) => void
  readonly onRequestTrashFile?: (node: WorkspaceFilesystemNode) => void
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  // Compact UI has no hover affordance, so pin the trigger visible.
  // While the popover is open or the row is busy, keep the trigger visible
  // so progress stays anchored to the action the user just triggered.
  const alwaysVisible = useIsCompactUi() || open || busy

  return (
    <ActionPopover
      label={t(FILETREE_ROW_I18N_KEYS.actionMenu)}
      open={open}
      onOpenChange={setOpen}
      busy={busy}
      triggerClassName={cn(
        'ml-auto size-5 shrink-0 p-0 transition-opacity duration-100',
        alwaysVisible && 'opacity-100',
        !alwaysVisible && 'opacity-0 group-hover/filetree-row:opacity-100',
      )}
      contentClassName="min-w-32 max-w-56"
    >
      {({ close }) => (
        <div role="list">
          {onOpenFile || onDownloadFile ? (
            <div className="space-y-0.5 p-1" role="group">
              {onOpenFile ? (
                <div role="listitem">
                  <ActionPopoverItem
                    label={t(FILETREE_ROW_I18N_KEYS.open)}
                    icon={<FileTerminal />}
                    disabled={busy}
                    busy={busy}
                    onSelect={() => {
                      close()
                      onOpenFile(node)
                    }}
                  />
                </div>
              ) : null}
              {onDownloadFile ? (
                <div role="listitem">
                  <ActionPopoverItem
                    label={t(FILETREE_ROW_I18N_KEYS.download)}
                    icon={<Download />}
                    onSelect={() => {
                      close()
                      onDownloadFile(node)
                    }}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
          {onRequestTrashFile ? (
            <div className="space-y-0.5 border-t border-border p-1" role="group">
              <div role="listitem">
                <ActionPopoverItem
                  label={t(FILETREE_ROW_I18N_KEYS.delete)}
                  icon={<Trash2 />}
                  destructive
                  onSelect={() => {
                    close()
                    onRequestTrashFile(node)
                  }}
                />
              </div>
            </div>
          ) : null}
        </div>
      )}
    </ActionPopover>
  )
}
