import { ChevronRight, Download, File, FileTerminal, Folder, Loader2, Trash2 } from '@lucide/vue'
import { defineComponent, ref } from 'vue'
import type { FunctionalComponent } from 'vue'
import type { WorkspaceFilesystemNode } from '#/shared/api-types.ts'
import { ActionPopover, ActionPopoverItem } from '#/web/components/ActionPopover.tsx'
import type { FiletreeRow } from '#/web/components/workspace-pane/filetree-collection.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { cn } from '#/web/lib/cn.ts'
import { useT } from '#/web/stores/i18n-vue.ts'

const FILETREE_ROW_I18N_KEYS = {
  open: 'app-chrome.open',
  download: 'filetree.download',
  delete: 'menu.edit.delete',
  actionMenu: 'action.menu',
} as const satisfies Record<string, string>

interface FiletreeTreeRowProps {
  readonly row: FiletreeRow
  readonly rowIndex: number
  readonly hasChildItems: boolean
  readonly isExpanded: boolean
  readonly isSelected: boolean
  readonly isTabbable: boolean
  readonly isLoading: boolean
  readonly isOpeningFile: boolean
  readonly virtualStart: number
  readonly onKeydown: (node: WorkspaceFilesystemNode, event: KeyboardEvent) => void
  readonly onRowClick: (node: WorkspaceFilesystemNode, isExpanded: boolean) => void
  readonly onToggleDirectory: (key: string, expanded: boolean) => void
  readonly onSelect: (node: WorkspaceFilesystemNode) => void
  readonly onOpenFile?: (node: WorkspaceFilesystemNode) => void
  readonly onDownloadFile?: (node: WorkspaceFilesystemNode) => void
  readonly onRequestTrashFile?: (node: WorkspaceFilesystemNode) => void
}

export const FiletreeTreeRow: FunctionalComponent<FiletreeTreeRowProps> = (props) => {
  const { node } = props.row
  const isDirectory = node.kind === 'directory'
  return (
    <div
      role="treeitem"
      aria-label={node.name}
      aria-level={props.row.level}
      aria-posinset={props.row.posInSet}
      aria-setsize={props.row.setSize}
      aria-selected={props.isSelected}
      aria-expanded={isDirectory ? props.isExpanded : undefined}
      tabindex={props.isTabbable ? 0 : -1}
      data-filetree-row=""
      data-filetree-row-index={props.rowIndex}
      class={cn(
        'group/filetree-row absolute left-0 top-0 w-full cursor-pointer text-foreground outline-none transition-colors duration-100',
        !props.isSelected && 'hover:bg-muted focus:bg-muted active:bg-muted',
        props.isSelected && 'bg-selected text-selected-foreground',
        'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
      )}
      style={{ transform: `translateY(${props.virtualStart}px)` }}
      onClick={(event: MouseEvent) => handleTreeItemClick(event, node, props.isExpanded, props.onRowClick)}
      onDblclick={
        props.onOpenFile ? (event: MouseEvent) => handleItemDoubleClick(event, node, props.onOpenFile!) : undefined
      }
      onKeydown={(event: KeyboardEvent) => props.onKeydown(node, event)}
    >
      <div
        class="flex w-full min-w-0 items-center gap-1 py-0.5 pl-1.5 pr-3"
        style={{ paddingLeft: `${(props.row.level - 1) * 12 + 6}px` }}
      >
        <span class="flex w-3 shrink-0 items-center justify-center text-muted-foreground">
          {props.hasChildItems ? (
            <button
              type="button"
              data-filetree-chevron=""
              class="flex size-3 items-center justify-center rounded-sm outline-none"
              onClick={(event: MouseEvent) => {
                event.stopPropagation()
                props.onToggleDirectory(node.id, !props.isExpanded)
              }}
              aria-label={node.name}
            >
              {props.isLoading ? (
                <Loader2 size={11} aria-hidden="true" class="animate-spin" />
              ) : (
                <ChevronRight
                  size={12}
                  aria-hidden="true"
                  class={cn('transition-transform', props.isExpanded ? 'rotate-90' : 'rotate-0')}
                />
              )}
            </button>
          ) : null}
        </span>
        <span class="flex w-3.5 shrink-0 items-center justify-center text-muted-foreground">
          {isDirectory ? <Folder size={12} aria-hidden="true" /> : <File size={12} aria-hidden="true" />}
        </span>
        <span class="min-w-0 flex-1 truncate text-current">{node.name}</span>
        {!isDirectory && (props.onOpenFile || props.onDownloadFile || props.onRequestTrashFile) ? (
          <FiletreeActionMenu
            node={node}
            busy={props.isOpeningFile}
            onOpenFile={
              props.onOpenFile
                ? (target) => {
                    props.onSelect(target)
                    props.onOpenFile?.(target)
                  }
                : undefined
            }
            onDownloadFile={props.onDownloadFile}
            onRequestTrashFile={props.onRequestTrashFile}
          />
        ) : null}
      </div>
    </div>
  )
}

FiletreeTreeRow.props = [
  'row',
  'rowIndex',
  'hasChildItems',
  'isExpanded',
  'isSelected',
  'isTabbable',
  'isLoading',
  'isOpeningFile',
  'virtualStart',
  'onKeydown',
  'onRowClick',
  'onToggleDirectory',
  'onSelect',
  'onOpenFile',
  'onDownloadFile',
  'onRequestTrashFile',
]

function handleTreeItemClick(
  event: MouseEvent,
  node: WorkspaceFilesystemNode,
  isExpanded: boolean,
  onRowClick: (node: WorkspaceFilesystemNode, isExpanded: boolean) => void,
): void {
  if (event.target instanceof Element && isFiletreeRowControl(event.target)) return
  onRowClick(node, isExpanded)
}

function isFiletreeRowControl(target: Element): boolean {
  return target.closest('[data-action-popover-trigger], [data-filetree-chevron]') !== null
}

function handleItemDoubleClick(
  event: MouseEvent,
  node: WorkspaceFilesystemNode,
  onOpenFile: (node: WorkspaceFilesystemNode) => void,
): void {
  if (node.kind !== 'file') return
  if (event.target instanceof Element && event.target.closest('[data-action-popover-trigger]')) return
  onOpenFile(node)
}

interface FiletreeActionMenuProps {
  readonly node: WorkspaceFilesystemNode
  readonly busy: boolean
  readonly onOpenFile?: (node: WorkspaceFilesystemNode) => void
  readonly onDownloadFile?: (node: WorkspaceFilesystemNode) => void
  readonly onRequestTrashFile?: (node: WorkspaceFilesystemNode) => void
}

const FiletreeActionMenu = defineComponent<FiletreeActionMenuProps>({
  name: 'FiletreeActionMenu',
  props: ['node', 'busy', 'onOpenFile', 'onDownloadFile', 'onRequestTrashFile'],

  setup(props) {
    const t = useT()
    const open = ref(false)
    const compact = useIsCompactUi()
    return () => {
      const alwaysVisible = compact.value || open.value || props.busy
      return (
        <ActionPopover
          label={t(FILETREE_ROW_I18N_KEYS.actionMenu)}
          open={open.value}
          onOpenChange={(next) => {
            open.value = next
          }}
          busy={props.busy}
          triggerClass={cn(
            'ml-auto size-5 shrink-0 p-0 transition-opacity duration-100',
            alwaysVisible && 'opacity-100',
            !alwaysVisible && 'opacity-0 group-hover/filetree-row:opacity-100',
          )}
          contentClass="min-w-32 max-w-56"
        >
          {({ close }: { close: () => void }) => (
            <div role="list">
              {props.onOpenFile || props.onDownloadFile ? (
                <div class="space-y-0.5 p-1" role="group">
                  {props.onOpenFile ? (
                    <div role="listitem">
                      <ActionPopoverItem
                        label={t(FILETREE_ROW_I18N_KEYS.open)}
                        icon={<FileTerminal />}
                        disabled={props.busy}
                        busy={props.busy}
                        onSelect={() => {
                          close()
                          props.onOpenFile?.(props.node)
                        }}
                      />
                    </div>
                  ) : null}
                  {props.onDownloadFile ? (
                    <div role="listitem">
                      <ActionPopoverItem
                        label={t(FILETREE_ROW_I18N_KEYS.download)}
                        icon={<Download />}
                        onSelect={() => {
                          close()
                          props.onDownloadFile?.(props.node)
                        }}
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}
              {props.onRequestTrashFile ? (
                <div class="space-y-0.5 border-t border-border p-1" role="group">
                  <div role="listitem">
                    <ActionPopoverItem
                      label={t(FILETREE_ROW_I18N_KEYS.delete)}
                      icon={<Trash2 />}
                      destructive
                      onSelect={() => {
                        close()
                        props.onRequestTrashFile?.(props.node)
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
  },
})
