import type { RepoBranchState } from '#/web/stores/workspaces/types.ts'
import { useT } from '#/web/stores/i18n.ts'
import {
  useBranchActionItems,
  type BranchActionItem,
  type BranchActionSurface,
} from '#/web/hooks/useBranchActionItems.ts'
import type { BranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import { useBranchActions } from '#/web/hooks/useBranchActions.tsx'
import { useAsyncPending } from '#/web/hooks/useAsyncPending.ts'
import { ActionPopover, ActionPopoverItem } from '#/web/components/ActionPopover.tsx'
import { cn } from '#/web/lib/cn.ts'
interface Props {
  repo: BranchActionRepo
  branch: RepoBranchState
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function BranchActionsMenu({ repo, branch, open, onOpenChange }: Props) {
  const branchActions = useBranchActions(repo, branch)
  const { mainItems, destructiveItems } = useBranchActionItems(repo, branch, branchActions, {
    workspacePaneRoute: undefined,
  })

  // Dialogs are no longer rendered here. The shared
  // `BranchActionDialogHost` is mounted once at the workspace level
  // (`RepoWorkspace`), and its open/close state is held by
  // `useBranchActionDialogsStore` so that triggering a confirm from a
  // temporary surface (e.g. the zen-mode HoverCard popover) does
  // not get its dialog torn down when the surface unmounts.
  return (
    <BranchActionsPopover
      mainItems={mainItems}
      destructiveItems={destructiveItems}
      open={open}
      onOpenChange={onOpenChange}
    />
  )
}

export function BranchActionsPopover({
  mainItems,
  destructiveItems,
  open,
  onOpenChange,
}: Pick<BranchActionSurface, 'mainItems' | 'destructiveItems'> & {
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const t = useT()
  const { pending: pendingAction, run } = useAsyncPending<BranchActionItem['id']>()
  const visibleMainItems = mainItems.filter((item) => item.visible)
  const visibleDestructiveItems = destructiveItems.filter((item) => item.visible)
  const visibleItems = [...visibleMainItems, ...visibleDestructiveItems]
  const busyAction = pendingAction ?? visibleItems.find((item) => item.busy)?.id ?? null

  function setOpen(next: boolean) {
    onOpenChange?.(next)
  }

  function runItem(item: BranchActionItem, close: () => void) {
    if (branchActionMenuItemDisabled(item, busyAction)) return
    close()
    void run(item.id, item.onSelect)
  }

  return (
    <ActionPopover label={t('action.menu')} open={open} onOpenChange={setOpen} busy={busyAction !== null}>
      {({ close }) => (
        <>
          {visibleMainItems.length > 0 && (
            <div className="space-y-0.5 p-1" role="list">
              {visibleMainItems.map((item) => (
                <div key={item.id} role="listitem">
                  <BranchActionPopoverItem item={item} busy={busyAction} onSelect={() => runItem(item, close)} />
                </div>
              ))}
            </div>
          )}
          {visibleDestructiveItems.length > 0 && (
            <div className={cn(visibleMainItems.length > 0 && 'border-t border-separator', 'p-1')}>
              <div className="space-y-0.5" role="list">
                {visibleDestructiveItems.map((item) => (
                  <div key={item.id} role="listitem">
                    <BranchActionPopoverItem item={item} busy={busyAction} onSelect={() => runItem(item, close)} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </ActionPopover>
  )
}

function BranchActionPopoverItem({
  item,
  busy,
  onSelect,
}: {
  item: BranchActionItem
  busy: BranchActionItem['id'] | null
  onSelect: () => void
}) {
  const disabled = branchActionMenuItemDisabled(item, busy)
  return (
    <ActionPopoverItem
      disabled={disabled}
      title={item.title}
      label={item.label}
      icon={item.icon}
      shortcut={item.shortcut}
      busy={busy === item.id || item.busy}
      destructive={item.destructive}
      onSelect={onSelect}
    />
  )
}

function branchActionMenuItemDisabled(item: BranchActionItem, busy: BranchActionItem['id'] | null): boolean {
  return item.disabled || busy !== null
}
