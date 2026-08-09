import { Check, ChevronDown, Plus, X } from '@lucide/vue'
import { PopoverTrigger } from 'reka-ui'
import { defineComponent, ref } from 'vue'
import type { ButtonHTMLAttributes, FunctionalComponent, HTMLAttributes } from 'vue'
import { Button, buttonVariants } from '#/web/components/ui/button.tsx'
import { Popover, PopoverContent } from '#/web/components/ui/popover.tsx'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { Separator } from '#/web/components/ui/separator.tsx'
import { ToolbarClosableTab } from '#/web/components/tab-strip/ToolbarClosableTab.tsx'
import type { ToolbarTabClose } from '#/web/components/tab-strip/ToolbarClosableTab.tsx'
import { toolbarTabChromeClassName, toolbarTabIconClassName } from '#/web/components/tab-strip/tab-variants.ts'
import type { FocusRegistry } from '#/web/components/tab-strip/useFocusRegistry.ts'
import { useSortableTab } from '#/web/components/tab-strip/useSortableTab.ts'
import {
  isPendingWorkspacePaneTabItem,
  isRuntimeWorkspacePaneTabItem,
} from '#/web/components/workspace-pane/workspace-pane-tab-types.ts'
import type {
  WorkspacePaneRuntimeTabItem,
  WorkspacePaneTabItem,
} from '#/web/components/workspace-pane/workspace-pane-tab-types.ts'
import { WorkspacePaneTabTitle } from '#/web/components/workspace-pane/WorkspacePaneTabTitle.tsx'
import { cn } from '#/web/lib/cn.ts'
import { toButtonVNodeRef } from '#/web/components/ui/refs.ts'
import type { ElementRef } from '#/web/components/ui/refs.ts'
import { terminalHasKeyboardFocus } from '#/web/terminal-focus.ts'

export type WorkspacePaneT = (key: string, params?: Record<string, string | number>) => string

export interface WorkspacePaneTabCreateAction {
  label: string
  busy?: boolean
  blocksTabInteraction?: boolean
  onCreate: () => void
}

interface WorkspacePaneTabSwitcherPopoverProps {
  items: WorkspacePaneTabItem[]
  activeTabIdentity: string | null
  label: string
  createAction: WorkspacePaneTabCreateAction | null
  tabInteractionBlocked: boolean
  onSelect: (identity: string) => void
  onClose: (identity: string) => void
  t: WorkspacePaneT
}

export const WorkspacePaneTabSwitcherPopover = defineComponent<WorkspacePaneTabSwitcherPopoverProps>({
  name: 'WorkspacePaneTabSwitcherPopover',
  props: ['items', 'activeTabIdentity', 'label', 'createAction', 'tabInteractionBlocked', 'onSelect', 'onClose', 't'],

  setup(props) {
    const open = ref(false)
    const selectView = (identity: string) => {
      if (props.tabInteractionBlocked) return
      open.value = false
      props.onSelect(identity)
    }

    const selectNew = () => {
      if (!props.createAction || props.createAction.busy) return
      open.value = false
      props.createAction.onCreate()
    }

    return () => (
      <Popover open={open.value} onOpenChange={(nextOpen) => (open.value = nextOpen)}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" class="h-7 w-7 shrink-0" aria-label={props.label} title={props.label}>
            <ChevronDown size={14} />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="start"
          class="flex w-max min-w-48 max-w-72 flex-col overflow-hidden p-0"
          aria-label={props.label}
          tabindex={-1}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            if (event.target instanceof HTMLElement) event.target.focus({ preventScroll: true })
          }}
          onCloseAutoFocus={(event) => {
            // A terminal may win the focus race before Reka finishes closing.
            // Preserve that completed handoff instead of restoring the trigger.
            if (terminalHasKeyboardFocus()) event.preventDefault()
          }}
        >
          <ScrollArea class="max-h-64" scrollbarMode="compact">
            <div class="space-y-0.5 p-1" role="list">
              {props.items.map((item) => {
                const selected = item.identity === props.activeTabIdentity
                const pending = isPendingWorkspacePaneTabItem(item)
                return (
                  <div key={item.identity} class="group relative flex items-center" role="listitem">
                    <button
                      type="button"
                      class={cn(
                        'flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm py-1 pl-2 text-left text-sm outline-none transition-colors duration-100 hover:bg-accent hover:text-accent-foreground',
                        'pr-8',
                        selected &&
                          'bg-selected text-selected-foreground hover:bg-selected hover:text-selected-foreground',
                      )}
                      onClick={() => selectView(item.identity)}
                      disabled={props.tabInteractionBlocked}
                      aria-label={item.tooltip}
                      aria-current={selected ? 'true' : undefined}
                    >
                      <span class="flex size-3.5 shrink-0 items-center justify-center">
                        {selected ? (
                          <Check size={13} aria-hidden="true" />
                        ) : (
                          <WorkspacePaneTabIcon item={item} active={false} />
                        )}
                      </span>
                      <span class="min-w-0 flex-1 truncate">{item.label || item.tooltip}</span>
                      {isRuntimeWorkspacePaneTabItem(item) && item.attention ? (
                        <>
                          <span class="h-2 w-2 shrink-0 rounded-full bg-notification" aria-hidden="true" />
                          <span class="sr-only">{runtimeAttentionLabel(item, props.t)}</span>
                        </>
                      ) : null}
                    </button>
                    {!pending && item.closable !== false ? (
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        class="absolute right-1 top-1/2 size-6 -translate-y-1/2 text-muted-foreground"
                        onPointerdown={(event) => event.stopPropagation()}
                        onClick={() => props.onClose(item.identity)}
                        disabled={props.tabInteractionBlocked}
                        title={item.closeLabel}
                        aria-label={item.closeLabel}
                      >
                        <X size={13} />
                      </Button>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </ScrollArea>
          {props.createAction ? (
            <div class="border-t border-separator p-1">
              <button
                type="button"
                class={cn(
                  'flex h-7 w-full items-center gap-2 rounded-sm px-2 text-left text-sm text-popover-foreground outline-none transition-colors duration-100',
                  props.createAction.busy
                    ? 'cursor-not-allowed opacity-70'
                    : 'cursor-pointer hover:bg-accent hover:text-accent-foreground',
                )}
                onClick={selectNew}
                disabled={props.createAction.busy}
                aria-busy={props.createAction.busy ? 'true' : undefined}
              >
                <span class="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground">
                  <Plus size={14} />
                </span>
                <span class="min-w-0 flex-1 truncate">{props.createAction.label}</span>
              </button>
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
    )
  },
})

interface WorkspacePaneNewButtonProps {
  id?: string
  action: WorkspacePaneTabCreateAction
  buttonRef?: ElementRef<HTMLButtonElement>
}

export const WorkspacePaneNewButton: FunctionalComponent<WorkspacePaneNewButtonProps> = (props) => (
  <button
    ref={toButtonVNodeRef(props.buttonRef)}
    type="button"
    class={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'h-7 w-7 shrink-0')}
    data-slot="button"
    data-variant="ghost"
    data-size="icon"
    id={props.id}
    onClick={props.action.onCreate}
    disabled={props.action.busy}
    aria-busy={props.action.busy ? 'true' : undefined}
    aria-label={props.action.label}
    title={props.action.label}
    data-workspace-pane-new-button=""
  >
    <Plus size={14} />
  </button>
)

WorkspacePaneNewButton.props = ['id', 'action', 'buttonRef']

export interface WorkspacePaneTabProps {
  item: WorkspacePaneTabItem
  isActive: boolean
  isSelected: boolean
  isFocusable: boolean
  index?: number
  total?: number
  tabId: string
  focusRegistry: FocusRegistry<string, HTMLButtonElement>
  onSelect: (identity: string) => void
  onClose: (identity: string) => void
  onKeyDown: (event: KeyboardEvent, identity: string) => void
  t: WorkspacePaneT
  interactionDisabled: boolean
  compact?: boolean
  showSeparator?: boolean
  onHoverChange?: (identity: string | null) => void
}

interface WorkspacePaneTabChromeProps extends Omit<WorkspacePaneTabProps, 'focusRegistry'> {
  isDragging?: boolean
  buttonRef?: ElementRef<HTMLButtonElement>
  containerProps?: HTMLAttributes
  buttonProps?: ButtonHTMLAttributes
}

function workspacePaneTabCloseProps(
  item: WorkspacePaneTabItem,
  compact: boolean,
  isActive: boolean,
  interactionDisabled: boolean,
  onClose: (identity: string) => void,
): ToolbarTabClose | undefined {
  if (compact) return undefined
  if (isPendingWorkspacePaneTabItem(item) || item.closable === false) return { kind: 'placeholder' }
  return {
    kind: 'action',
    label: item.closeLabel,
    visible: isActive,
    disabled: interactionDisabled,
    onClose: (event) => {
      event.preventDefault()
      event.stopPropagation()
      onClose(item.identity)
    },
  }
}

const WorkspacePaneTabChrome: FunctionalComponent<WorkspacePaneTabChromeProps> = (props) => {
  const attentionLabel =
    isRuntimeWorkspacePaneTabItem(props.item) && props.item.attention
      ? runtimeAttentionLabel(props.item, props.t)
      : null
  const accessibleLabel = props.item.label || props.item.tooltip
  const ariaLabel = attentionLabel ? `${accessibleLabel} — ${attentionLabel}` : accessibleLabel
  const close = workspacePaneTabCloseProps(
    props.item,
    props.compact ?? false,
    props.isActive,
    props.interactionDisabled,
    props.onClose,
  )
  const collectionAria =
    props.index !== undefined && props.total !== undefined
      ? { 'aria-posinset': props.index + 1, 'aria-setsize': props.total }
      : {}

  return (
    <ToolbarClosableTab
      containerProps={{
        ...props.containerProps,
        'data-workspace-pane-tab-tooltip-id': props.item.identity,
        'data-workspace-pane-tab-scroll-target': '',
        'data-workspace-pane-pending-tab': isPendingWorkspacePaneTabItem(props.item) ? props.item.type : undefined,
        onPointerenter: (event) => {
          props.containerProps?.onPointerenter?.(event)
          props.onHoverChange?.(props.item.identity)
        },
        onPointerleave: (event) => {
          props.containerProps?.onPointerleave?.(event)
          props.onHoverChange?.(null)
        },
      }}
      containerClass={toolbarTabChromeClassName({
        variant: 'workspace-pane',
        active: props.isActive,
        dragging: props.isDragging ?? false,
        compact: props.compact ?? false,
      })}
      overlay={
        props.showSeparator ? (
          <Separator orientation="vertical" class="absolute right-0 top-1/2 -translate-y-1/2" />
        ) : null
      }
      buttonRef={props.buttonRef}
      buttonProps={{
        ...props.buttonProps,
        role: 'tab',
        id: props.tabId,
        'aria-selected': props.isSelected,
        'aria-label': ariaLabel,
        'aria-controls': props.item.panelId,
        'aria-keyshortcuts': close?.kind === 'action' ? 'Delete' : undefined,
        ...collectionAria,
        tabIndex: props.isFocusable ? 0 : -1,
        disabled: props.interactionDisabled,
        'aria-disabled': props.interactionDisabled ? true : undefined,
        onClick: () => props.onSelect(props.item.identity),
        onKeydown: (event) => props.onKeyDown(event, props.item.identity),
      }}
      close={close}
    >
      <WorkspacePaneTabIcon item={props.item} active={props.isActive} compact={props.compact} />
      <WorkspacePaneTabTitle item={props.item} />
      {isRuntimeWorkspacePaneTabItem(props.item) && props.item.attention ? (
        <>
          <span class="relative flex h-2 w-2 shrink-0">
            <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-notification opacity-75" />
            <span class="relative inline-flex h-2 w-2 rounded-full bg-notification" />
          </span>
          <span class="sr-only">{attentionLabel}</span>
        </>
      ) : null}
    </ToolbarClosableTab>
  )
}

WorkspacePaneTabChrome.props = [
  'item',
  'isActive',
  'isSelected',
  'isFocusable',
  'index',
  'total',
  'isDragging',
  'tabId',
  'buttonRef',
  'containerProps',
  'buttonProps',
  'onSelect',
  'onClose',
  'onKeyDown',
  't',
  'interactionDisabled',
  'compact',
  'showSeparator',
  'onHoverChange',
]

export const WorkspacePaneTab: FunctionalComponent<WorkspacePaneTabProps> = (props) => (
  <WorkspacePaneTabChrome {...props} buttonRef={props.focusRegistry.setRef(props.item.identity)} />
)

WorkspacePaneTab.props = [
  'item',
  'isActive',
  'isSelected',
  'isFocusable',
  'index',
  'total',
  'tabId',
  'focusRegistry',
  'onSelect',
  'onClose',
  'onKeyDown',
  't',
  'interactionDisabled',
  'compact',
  'showSeparator',
  'onHoverChange',
]

interface SortableWorkspacePaneTabProps extends WorkspacePaneTabProps {
  sortableIdentity: string
  sortableIndex: number
}

export const SortableWorkspacePaneTab = defineComponent<SortableWorkspacePaneTabProps>({
  name: 'SortableWorkspacePaneTab',
  props: [
    'sortableIdentity',
    'sortableIndex',
    'item',
    'isActive',
    'isSelected',
    'isFocusable',
    'index',
    'total',
    'tabId',
    'focusRegistry',
    'onSelect',
    'onClose',
    'onKeyDown',
    't',
    'interactionDisabled',
    'compact',
    'showSeparator',
    'onHoverChange',
  ],

  setup(props) {
    const sortable = useSortableTab(
      () => props.sortableIdentity,
      () => props.sortableIndex,
      {
        disabled: () => props.interactionDisabled,
        onButtonRef: (node) => props.focusRegistry.setRef(props.item.identity)(node),
      },
    )

    return () => (
      <div ref={sortable.containerRef} class="touch-none select-none">
        <WorkspacePaneTabChrome
          item={props.item}
          isActive={props.isActive}
          isSelected={props.isSelected}
          isFocusable={props.isFocusable}
          index={props.index}
          total={props.total}
          tabId={props.tabId}
          onSelect={props.onSelect}
          onClose={props.onClose}
          onKeyDown={(event, identity) => {
            if (sortable.isDragging.value) return
            props.onKeyDown(event, identity)
          }}
          t={props.t}
          interactionDisabled={props.interactionDisabled}
          compact={props.compact}
          showSeparator={props.showSeparator}
          onHoverChange={props.onHoverChange}
          isDragging={sortable.isDragging.value}
          buttonRef={sortable.setButtonRef}
        />
      </div>
    )
  },
})

interface WorkspacePaneTabIconProps {
  item: WorkspacePaneTabItem
  active: boolean
  compact?: boolean
}

const WorkspacePaneTabIcon: FunctionalComponent<WorkspacePaneTabIconProps> = (props) => {
  const iconClass = toolbarTabIconClassName(props.active, props.compact ?? false)
  const Icon = props.item.icon
  return <Icon size={13} class={iconClass} />
}

WorkspacePaneTabIcon.props = ['item', 'active', 'compact']

function runtimeAttentionLabel(item: WorkspacePaneRuntimeTabItem, t: WorkspacePaneT): string {
  const attentionLabelKey = item.attentionLabelKey
  return attentionLabelKey ? t(attentionLabelKey) : item.tooltip
}
