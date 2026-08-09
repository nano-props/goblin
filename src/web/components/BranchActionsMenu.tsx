import { computed, defineComponent } from 'vue'
import type { FunctionalComponent, PropType } from 'vue'
import type { BranchSnapshotInfo } from '#/shared/git-types.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import { useBranchActionItems } from '#/web/hooks/useBranchActionItems.tsx'
import type { BranchActionItem, BranchActionSurface } from '#/web/hooks/useBranchActionItems.tsx'
import type { BranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import { useBranchActions } from '#/web/hooks/useBranchActions.tsx'
import { useAsyncPending } from '#/web/hooks/useAsyncPending.ts'
import { ActionPopover, ActionPopoverItem } from '#/web/components/ActionPopover.tsx'
import { cn } from '#/web/lib/cn.ts'
interface Props {
  repo: BranchActionRepo
  branch: BranchSnapshotInfo
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export const BranchActionsMenu = defineComponent<Props>({
  name: 'BranchActionsMenu',
  props: {
    repo: { type: Object as PropType<BranchActionRepo>, required: true },
    branch: { type: Object as PropType<BranchSnapshotInfo>, required: true },
    open: { type: Boolean, default: undefined },
    onOpenChange: Function as PropType<(open: boolean) => void>,
  },

  setup(props) {
    const branchActions = useBranchActions(
      () => props.repo,
      () => props.branch,
    )
    const items = useBranchActionItems(
      () => props.repo,
      () => props.branch,
      branchActions,
      {
        workspacePaneRoute: undefined,
      },
    )

    // Dialog state is owned by the workspace-level host, so this temporary
    // menu surface can close without tearing down a confirmation workflow.
    return () => (
      <BranchActionsPopover
        mainItems={items.value.mainItems}
        destructiveItems={items.value.destructiveItems}
        open={props.open}
        onOpenChange={props.onOpenChange}
      />
    )
  },
})

type BranchActionsPopoverProps = Pick<BranchActionSurface, 'mainItems' | 'destructiveItems'> & {
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export const BranchActionsPopover = defineComponent<BranchActionsPopoverProps>({
  name: 'BranchActionsPopover',
  props: {
    mainItems: { type: Array as PropType<BranchActionItem[]>, required: true },
    destructiveItems: { type: Array as PropType<BranchActionItem[]>, required: true },
    open: { type: Boolean, default: undefined },
    onOpenChange: Function as PropType<(open: boolean) => void>,
  },

  setup(props) {
    const t = useT()
    const { pending: pendingAction, run } = useAsyncPending<BranchActionItem['id']>()
    const visibleMainItems = computed(() => props.mainItems.filter((item) => item.visible))
    const visibleDestructiveItems = computed(() => props.destructiveItems.filter((item) => item.visible))
    const busyAction = computed(
      () =>
        pendingAction.value ??
        [...visibleMainItems.value, ...visibleDestructiveItems.value].find((item) => item.busy)?.id ??
        null,
    )

    function runItem(item: BranchActionItem, close: () => void): void {
      if (branchActionMenuItemDisabled(item, busyAction.value)) return
      close()
      void run(item.id, item.onSelect)
    }

    return () => (
      <ActionPopover
        label={t('action.menu')}
        open={props.open}
        onOpenChange={(next) => props.onOpenChange?.(next)}
        busy={busyAction.value !== null}
      >
        {({ close }: { close: () => void }) => (
          <>
            {visibleMainItems.value.length > 0 ? (
              <div class="space-y-0.5 p-1" role="list">
                {visibleMainItems.value.map((item) => (
                  <div key={item.id} role="listitem">
                    <BranchActionPopoverItem
                      item={item}
                      busy={busyAction.value}
                      onSelect={() => runItem(item, close)}
                    />
                  </div>
                ))}
              </div>
            ) : null}
            {visibleDestructiveItems.value.length > 0 ? (
              <div class={cn(visibleMainItems.value.length > 0 && 'border-t border-separator', 'p-1')}>
                <div class="space-y-0.5" role="list">
                  {visibleDestructiveItems.value.map((item) => (
                    <div key={item.id} role="listitem">
                      <BranchActionPopoverItem
                        item={item}
                        busy={busyAction.value}
                        onSelect={() => runItem(item, close)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}
      </ActionPopover>
    )
  },
})

interface BranchActionPopoverItemProps {
  item: BranchActionItem
  busy: BranchActionItem['id'] | null
  onSelect: () => void
}

const BranchActionPopoverItem: FunctionalComponent<BranchActionPopoverItemProps> = (props) => {
  const disabled = branchActionMenuItemDisabled(props.item, props.busy)
  return (
    <ActionPopoverItem
      disabled={disabled}
      title={props.item.title}
      label={props.item.label}
      icon={props.item.icon}
      shortcut={props.item.shortcut}
      busy={props.busy === props.item.id || props.item.busy}
      destructive={props.item.destructive}
      onSelect={props.onSelect}
    />
  )
}

BranchActionPopoverItem.props = ['item', 'busy', 'onSelect']

function branchActionMenuItemDisabled(item: BranchActionItem, busy: BranchActionItem['id'] | null): boolean {
  return item.disabled || busy !== null
}
