import { Loader2, MoreHorizontal } from 'lucide-react'
import { useRef, useState } from 'react'
import type { RepoBranchState } from '#/web/stores/repos/types.ts'
import { useT } from '#/web/stores/i18n.ts'
import { Button } from '#/web/components/ui/button.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '#/web/components/ui/popover.tsx'
import { InlineShortcut } from '#/web/components/InlineShortcut.tsx'
import {
  useBranchActionItems,
  type BranchActionItem,
  type BranchActionSurface,
} from '#/web/hooks/useBranchActionItems.ts'
import type { BranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import { useBranchActions } from '#/web/hooks/useBranchActions.tsx'
import { useAsyncPending } from '#/web/hooks/useAsyncPending.ts'
import { cn } from '#/web/lib/cn.ts'
interface Props {
  repo: BranchActionRepo
  branch: RepoBranchState
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function BranchActionsMenu({ repo, branch, open, onOpenChange }: Props) {
  const branchActions = useBranchActions(repo, branch)
  const { mainItems, destructiveItems } = useBranchActionItems(repo, branch, branchActions)

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
  const [internalOpen, setInternalOpen] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const { pending: pendingAction, run } = useAsyncPending<BranchActionItem['id']>()
  const visibleMainItems = mainItems.filter((item) => item.visible)
  const visibleDestructiveItems = destructiveItems.filter((item) => item.visible)
  const visibleItems = [...visibleMainItems, ...visibleDestructiveItems]
  const busyAction = pendingAction ?? visibleItems.find((item) => item.busy)?.id ?? null
  const effectiveOpen = open ?? internalOpen

  function setOpen(next: boolean) {
    if (open === undefined) setInternalOpen(next)
    onOpenChange?.(next)
  }

  function runItem(item: BranchActionItem) {
    if (branchActionMenuItemDisabled(item, busyAction)) return
    setOpen(false)
    void run(item.id, item.onSelect)
  }

  return (
    <Popover open={effectiveOpen} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          title={t('action.menu')}
          aria-label={t('action.menu')}
          aria-busy={busyAction ? true : undefined}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {busyAction ? <Loader2 className="size-4 animate-spin" /> : <MoreHorizontal className="size-4" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-max min-w-48 max-w-72 overflow-hidden p-0"
        ref={contentRef}
        tabIndex={-1}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          contentRef.current?.focus({ preventScroll: true })
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {visibleMainItems.length > 0 && (
          <div className="space-y-0.5 p-1" role="list">
            {visibleMainItems.map((item) => (
              <div key={item.id} role="listitem">
                <BranchActionPopoverItem item={item} busy={busyAction} onSelect={() => runItem(item)} />
              </div>
            ))}
          </div>
        )}
        {visibleDestructiveItems.length > 0 && (
          <div className={cn(visibleMainItems.length > 0 && 'border-t border-separator', 'p-1')}>
            <div className="space-y-0.5" role="list">
              {visibleDestructiveItems.map((item) => (
                <div key={item.id} role="listitem">
                  <BranchActionPopoverItem item={item} busy={busyAction} onSelect={() => runItem(item)} />
                </div>
              ))}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
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
    <button
      type="button"
      disabled={disabled}
      title={item.title}
      onClick={onSelect}
      className={cn(
        'flex h-8 w-full cursor-pointer items-center gap-2 rounded-sm py-1 pl-2 pr-2 text-left text-sm outline-none transition-colors duration-100 hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50',
        item.destructive &&
          'text-danger hover:bg-danger-surface hover:text-danger focus:bg-danger-surface focus:text-danger',
        item.shortcut && 'whitespace-nowrap',
      )}
    >
      <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-3.5 [&_svg]:shrink-0">
        {busy === item.id || item.busy ? <Loader2 size={16} className="animate-spin" /> : item.icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.shortcut && <InlineShortcut shortcut={item.shortcut} />}
    </button>
  )
}

export function branchActionMenuItemDisabled(item: BranchActionItem, busy: BranchActionItem['id'] | null): boolean {
  return item.disabled || busy !== null
}
