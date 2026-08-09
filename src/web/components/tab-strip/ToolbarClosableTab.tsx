import { X } from '@lucide/vue'
import type { ButtonHTMLAttributes, FunctionalComponent, HTMLAttributes, VNodeChild } from 'vue'
import { cn } from '#/web/lib/cn.ts'
import { toButtonVNodeRef, toDivVNodeRef } from '#/web/components/ui/refs.ts'
import type { ElementRef } from '#/web/components/ui/refs.ts'

type DataAttributes = {
  [K in `data-${string}`]?: string | boolean | undefined
}

type ToolbarClosableTabContainerProps = Omit<HTMLAttributes, 'class'> & DataAttributes
type ToolbarClosableTabButtonProps = Omit<ButtonHTMLAttributes, 'class'> & DataAttributes & { tabIndex?: number }
export type ToolbarTabCloseEvent = MouseEvent

export type ToolbarTabClose =
  | {
      kind: 'action'
      label: string
      visible: boolean
      disabled?: boolean
      onClose: (event: ToolbarTabCloseEvent) => void
    }
  | { kind: 'placeholder' }

interface ToolbarClosableTabProps {
  containerRef?: ElementRef<HTMLDivElement>
  containerProps?: ToolbarClosableTabContainerProps
  containerClass: string
  overlay?: VNodeChild
  buttonRef?: ElementRef<HTMLButtonElement>
  buttonProps?: ToolbarClosableTabButtonProps
  buttonClass?: string
  close?: ToolbarTabClose
}

export const ToolbarClosableTab: FunctionalComponent<ToolbarClosableTabProps> = (props, { slots }) => (
  <div
    ref={toDivVNodeRef(props.containerRef)}
    {...props.containerProps}
    data-title-bar-chrome-region="interactive"
    class={props.containerClass}
  >
    {props.overlay}
    <button
      ref={toButtonVNodeRef(props.buttonRef)}
      type="button"
      {...props.buttonProps}
      class={cn(
        'flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-left text-inherit outline-none disabled:cursor-not-allowed disabled:opacity-70',
        props.buttonClass,
      )}
    >
      {slots.default?.()}
      {props.close?.kind === 'placeholder' ? (
        <ToolbarTabClosePlaceholder />
      ) : props.close ? (
        <ToolbarTabCloseAction
          label={props.close.label}
          visible={props.close.visible}
          disabled={props.close.disabled ?? false}
          onClose={props.close.onClose}
        />
      ) : null}
    </button>
  </div>
)

ToolbarClosableTab.props = [
  'containerRef',
  'containerProps',
  'containerClass',
  'overlay',
  'buttonRef',
  'buttonProps',
  'buttonClass',
  'close',
]

interface ToolbarTabCloseActionProps {
  label: string
  visible: boolean
  disabled: boolean
  onClose: (event: ToolbarTabCloseEvent) => void
}

const TOOLBAR_TAB_CLOSE_BASE_CLASS =
  'relative z-10 ml-auto shrink-0 cursor-pointer rounded border-0 bg-transparent p-0.5 text-muted-foreground transition-colors duration-100 before:absolute before:-inset-x-1.5 before:-inset-y-1 before:content-[""] hover:bg-accent hover:text-accent-foreground'

function toolbarTabCloseVisibilityClass(visible: boolean, disabled: boolean): string {
  if (visible) return disabled ? 'pointer-events-none opacity-100' : 'pointer-events-auto opacity-100'
  if (disabled) return 'pointer-events-none opacity-0'
  return 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100'
}

function stopToolbarTabCloseDragStart(event: Event): void {
  event.stopPropagation()
}

const ToolbarTabClosePlaceholder: FunctionalComponent = () => (
  <span
    aria-hidden="true"
    data-toolbar-tab-close-placeholder=""
    class={cn(TOOLBAR_TAB_CLOSE_BASE_CLASS, 'pointer-events-none invisible inline-flex items-center justify-center')}
  >
    <X size={14} />
  </span>
)

const ToolbarTabCloseAction: FunctionalComponent<ToolbarTabCloseActionProps> = (props) => (
  // A tablist may only own tabs. Keep the pointer affordance inside the
  // tab button; keyboard deletion is owned by the tab interaction itself.
  <span
    aria-hidden="true"
    data-toolbar-tab-close-action=""
    data-disabled={props.disabled ? 'true' : undefined}
    onPointerdown={stopToolbarTabCloseDragStart}
    onMousedown={stopToolbarTabCloseDragStart}
    onClick={props.disabled ? undefined : props.onClose}
    class={cn(TOOLBAR_TAB_CLOSE_BASE_CLASS, toolbarTabCloseVisibilityClass(props.visible, props.disabled))}
    title={props.label}
  >
    <X size={14} />
  </span>
)

ToolbarTabCloseAction.props = ['label', 'visible', 'disabled', 'onClose']
