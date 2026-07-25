import { Check, ChevronDown, Plus, X } from 'lucide-react'
import { useRef, useState, type ComponentPropsWithoutRef, type Ref } from 'react'
import { Button } from '#/web/components/ui/button.tsx'
import { cn } from '#/web/lib/cn.ts'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { Separator } from '#/web/components/ui/separator.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '#/web/components/ui/popover.tsx'
import { DelegatedTooltipLayer } from '#/web/components/DelegatedTooltipLayer.tsx'
import { ToolbarTabList } from '#/web/components/tab-strip/ToolbarTabStrip.tsx'
import { ToolbarClosableTab } from '#/web/components/tab-strip/ToolbarClosableTab.tsx'
import { toolbarTabChromeClassName, toolbarTabIconClassName } from '#/web/components/tab-strip/tab-variants.ts'
import type { FocusRegistry } from '#/web/components/tab-strip/useFocusRegistry.ts'
import { useSortableTab } from '#/web/components/tab-strip/useSortableTab.ts'
import {
  isPendingWorkspacePaneTabItem,
  isRuntimeWorkspacePaneTabItem,
  type WorkspacePaneRuntimeTabItem,
  type WorkspacePaneTabItem,
} from '#/web/components/workspace-pane/workspace-pane-tab-types.ts'
import { WorkspacePaneTabTitle } from '#/web/components/workspace-pane/WorkspacePaneTabTitle.tsx'
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
  onClose: (event: React.MouseEvent, identity: string) => void
  t: WorkspacePaneT
}

export function WorkspacePaneTabSwitcherPopover({
  items,
  activeTabIdentity,
  label,
  createAction,
  tabInteractionBlocked,
  onSelect,
  onClose,
  t,
}: WorkspacePaneTabSwitcherPopoverProps) {
  const [open, setOpen] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  const selectView = (identity: string) => {
    if (tabInteractionBlocked) return
    setOpen(false)
    onSelect(identity)
  }

  const selectNew = () => {
    if (!createAction || createAction.busy) return
    setOpen(false)
    createAction.onCreate()
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={label} title={label}>
          <ChevronDown size={14} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        className="flex w-max min-w-48 max-w-72 flex-col overflow-hidden p-0"
        aria-label={label}
        ref={contentRef}
        tabIndex={-1}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          contentRef.current?.focus({ preventScroll: true })
        }}
        onCloseAutoFocus={(event) => {
          // A terminal may win the focus race before Radix finishes closing.
          // Preserve that completed handoff instead of restoring the trigger.
          if (terminalHasKeyboardFocus()) event.preventDefault()
        }}
      >
        <ScrollArea className="max-h-64" scrollbarMode="compact">
          <div className="space-y-0.5 p-1" role="list">
            {items.map((item) => {
              const selected = item.identity === activeTabIdentity
              const pending = isPendingWorkspacePaneTabItem(item)
              return (
                <div key={item.identity} className="group relative flex items-center" role="listitem">
                  <button
                    type="button"
                    className={cn(
                      'flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm py-1 pl-2 text-left text-sm outline-none transition-colors duration-100 hover:bg-accent hover:text-accent-foreground',
                      'pr-8',
                      selected &&
                        'bg-selected text-selected-foreground hover:bg-selected hover:text-selected-foreground',
                    )}
                    onClick={() => selectView(item.identity)}
                    disabled={tabInteractionBlocked}
                    aria-label={item.tooltip}
                    aria-current={selected ? 'true' : undefined}
                  >
                    <span className="flex size-3.5 shrink-0 items-center justify-center">
                      {selected ? <Check size={13} aria-hidden /> : <WorkspacePaneTabIcon item={item} active={false} />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{item.label || item.tooltip}</span>
                    {isRuntimeWorkspacePaneTabItem(item) && item.attention && (
                      <>
                        <span className="h-2 w-2 shrink-0 rounded-full bg-notification" aria-hidden="true" />
                        <span className="sr-only">{runtimeAttentionLabel(item, t)}</span>
                      </>
                    )}
                  </button>
                  {!pending && item.closable !== false && (
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      className="absolute right-1 top-1/2 size-6 -translate-y-1/2 text-muted-foreground"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => onClose(event, item.identity)}
                      disabled={tabInteractionBlocked}
                      title={item.closeLabel}
                      aria-label={item.closeLabel}
                    >
                      <X size={13} />
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        </ScrollArea>
        {createAction && (
          <div className="border-t border-separator p-1">
            <button
              type="button"
              className={cn(
                'flex h-7 w-full items-center gap-2 rounded-sm px-2 text-left text-sm text-popover-foreground outline-none transition-colors duration-100',
                createAction.busy
                  ? 'cursor-not-allowed opacity-70'
                  : 'cursor-pointer hover:bg-accent hover:text-accent-foreground',
              )}
              onClick={selectNew}
              disabled={createAction.busy}
              aria-busy={createAction.busy ? 'true' : undefined}
            >
              <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground">
                <Plus size={14} />
              </span>
              <span className="min-w-0 flex-1 truncate">{createAction.label}</span>
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

export function WorkspacePaneNewButton({
  id,
  action,
  compact = false,
  ref,
}: {
  id?: string
  action: WorkspacePaneTabCreateAction
  compact?: boolean
  ref?: Ref<HTMLButtonElement>
}) {
  return (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      size="icon"
      className={cn('h-7 w-7 shrink-0', compact && 'w-7')}
      id={id}
      onClick={action.onCreate}
      disabled={action.busy}
      aria-busy={action.busy ? 'true' : undefined}
      aria-label={action.label}
      title={action.label}
      data-workspace-pane-new-button=""
    >
      <Plus size={14} />
    </Button>
  )
}

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
  onClose: (event: React.MouseEvent, identity: string) => void
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>, identity: string) => void
  t: WorkspacePaneT
  interactionDisabled: boolean
  compact?: boolean
  showSeparator?: boolean
  onHoverChange?: (identity: string | null) => void
}

interface WorkspacePaneTabChromeProps extends Omit<WorkspacePaneTabProps, 'focusRegistry'> {
  isDragging?: boolean
  buttonRef: ((node: HTMLButtonElement | null) => void) | undefined
  containerProps?: ComponentPropsWithoutRef<'div'>
  buttonProps?: ComponentPropsWithoutRef<'button'>
}

function WorkspacePaneTabChrome({
  item,
  isActive,
  isSelected,
  isFocusable,
  index,
  total,
  isDragging = false,
  tabId,
  buttonRef,
  containerProps,
  buttonProps,
  onSelect,
  onClose,
  onKeyDown,
  t,
  interactionDisabled,
  compact = false,
  showSeparator = false,
  onHoverChange,
}: WorkspacePaneTabChromeProps) {
  const attentionLabel = isRuntimeWorkspacePaneTabItem(item) && item.attention ? runtimeAttentionLabel(item, t) : null
  const accessibleLabel = item.label || item.tooltip
  const ariaLabel = attentionLabel ? `${accessibleLabel} — ${attentionLabel}` : accessibleLabel
  const closeProps =
    isPendingWorkspacePaneTabItem(item) || item.closable === false
      ? ({ closeButton: 'placeholder' } as const)
      : ({
          closeLabel: item.closeLabel,
          closeVisible: isActive && !compact,
          closeDisabled: interactionDisabled,
          onClose: (event: React.MouseEvent<HTMLButtonElement>) => onClose(event, item.identity),
        } as const)
  const collectionAria =
    index !== undefined && total !== undefined ? { 'aria-posinset': index + 1, 'aria-setsize': total } : {}
  return (
    <ToolbarClosableTab
      containerProps={{
        ...containerProps,
        'data-workspace-pane-tab-tooltip-id': item.identity,
        'data-workspace-pane-tab-scroll-target': '',
        'data-workspace-pane-pending-tab': isPendingWorkspacePaneTabItem(item) ? item.type : undefined,
        onPointerEnter: (event) => {
          containerProps?.onPointerEnter?.(event)
          onHoverChange?.(item.identity)
        },
        onPointerLeave: (event) => {
          containerProps?.onPointerLeave?.(event)
          onHoverChange?.(null)
        },
      }}
      containerClassName={toolbarTabChromeClassName({
        variant: 'workspace-pane',
        active: isActive,
        dragging: isDragging,
        compact,
      })}
      overlay={
        showSeparator ? (
          <Separator orientation="vertical" className="absolute right-0 top-1/2 -translate-y-1/2" />
        ) : null
      }
      buttonRef={buttonRef}
      buttonProps={{
        ...buttonProps,
        role: 'tab',
        id: tabId,
        'aria-selected': isSelected,
        'aria-label': ariaLabel,
        'aria-controls': item.panelId,
        ...collectionAria,
        tabIndex: isFocusable ? 0 : -1,
        disabled: interactionDisabled,
        'aria-disabled': interactionDisabled ? true : undefined,
        onClick: () => onSelect(item.identity),
        onKeyDown: (event) => onKeyDown(event, item.identity),
      }}
      {...closeProps}
    >
      <WorkspacePaneTabIcon item={item} active={isActive} compact={compact} />
      <WorkspacePaneTabTitle item={item} />
      {isRuntimeWorkspacePaneTabItem(item) && item.attention && (
        <>
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-notification opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-notification" />
          </span>
          <span className="sr-only">{attentionLabel}</span>
        </>
      )}
    </ToolbarClosableTab>
  )
}

export function WorkspacePaneTab({ item, focusRegistry, ...props }: WorkspacePaneTabProps) {
  return <WorkspacePaneTabChrome item={item} {...props} buttonRef={focusRegistry.setRef(item.identity)} />
}

export function SortableWorkspacePaneTab({
  sortableIdentity,
  item,
  focusRegistry,
  onKeyDown,
  ...props
}: WorkspacePaneTabProps & { sortableIdentity: string }) {
  const sortable = useSortableTab(sortableIdentity, {
    disabled: props.interactionDisabled,
    onButtonRef: focusRegistry.setRef(item.identity),
  })

  return (
    <div ref={sortable.setContainerRef} style={sortable.style} className="touch-none select-none">
      <WorkspacePaneTabChrome
        item={item}
        {...props}
        isDragging={sortable.isDragging}
        buttonRef={sortable.setButtonRef}
        containerProps={sortable.sortableListeners}
        buttonProps={sortable.attributes}
        onKeyDown={(event) => {
          sortable.sortableOnKeyDown?.(event)
          if (event.defaultPrevented || sortable.isDragging) return
          onKeyDown(event, item.identity)
        }}
      />
    </div>
  )
}

interface WorkspacePaneTabTooltipLayerProps extends ComponentPropsWithoutRef<'div'> {
  items: WorkspacePaneTabItem[]
}

export function WorkspacePaneTabTooltipLayer({ items, children, ...props }: WorkspacePaneTabTooltipLayerProps) {
  return (
    <DelegatedTooltipLayer
      items={items}
      selector="[data-workspace-pane-tab-tooltip-id]"
      attributeName="data-workspace-pane-tab-tooltip-id"
      getItemId={(item) => item.identity}
      renderTooltip={(item) => <div className="truncate text-xs font-semibold text-foreground">{item.tooltip}</div>}
      placement="bottom-start"
      delayMs={500}
      tooltipClassName="px-3 py-2"
      asChild
    >
      <ToolbarTabList aria-orientation={props.role === 'tablist' ? 'horizontal' : undefined} {...props}>
        {children}
      </ToolbarTabList>
    </DelegatedTooltipLayer>
  )
}

function WorkspacePaneTabIcon({
  item,
  active,
  compact = false,
}: {
  item: WorkspacePaneTabItem
  active: boolean
  compact?: boolean
}) {
  const className = toolbarTabIconClassName(active, compact)
  const Icon = item.icon
  return <Icon size={13} className={className} />
}

function runtimeAttentionLabel(item: WorkspacePaneRuntimeTabItem, t: WorkspacePaneT): string {
  const attentionLabelKey = item.attentionLabelKey
  return attentionLabelKey ? t(attentionLabelKey) : item.tooltip
}
