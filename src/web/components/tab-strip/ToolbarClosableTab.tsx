import { X } from 'lucide-react'
import type {
  ComponentPropsWithoutRef,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  Ref,
} from 'react'
import { cn } from '#/web/lib/cn.ts'

type DataAttributes = {
  [K in `data-${string}`]?: string | boolean | undefined
}

type ToolbarClosableTabContainerProps = Omit<ComponentPropsWithoutRef<'div'>, 'children' | 'className'> & DataAttributes
type ToolbarClosableTabButtonProps = Omit<ComponentPropsWithoutRef<'button'>, 'children' | 'className' | 'ref'> &
  DataAttributes
type ToolbarTabCloseEvent = ReactMouseEvent<HTMLButtonElement>

interface ToolbarClosableTabBaseProps {
  containerRef?: Ref<HTMLDivElement>
  containerProps?: ToolbarClosableTabContainerProps
  containerClassName: string
  overlay?: ReactNode
  buttonRef?: Ref<HTMLButtonElement>
  buttonProps?: ToolbarClosableTabButtonProps
  buttonClassName?: string
  children: ReactNode
}

type ToolbarClosableTabProps = ToolbarClosableTabBaseProps &
  (
    | {
        closeLabel: string
        closeVisible: boolean
        closeDisabled?: boolean
        closeButton?: true
        onClose: (event: ToolbarTabCloseEvent) => void
      }
    | {
        closeButton: 'placeholder'
        closeLabel?: never
        closeVisible?: never
        closeDisabled?: never
        onClose?: never
      }
    | {
        closeButton: false
        closeLabel?: never
        closeVisible?: never
        closeDisabled?: never
        onClose?: never
      }
  )

export function ToolbarClosableTab({
  containerRef,
  containerProps,
  containerClassName,
  overlay,
  buttonRef,
  buttonProps,
  buttonClassName,
  children,
  ...closeProps
}: ToolbarClosableTabProps) {
  return (
    <div
      ref={containerRef}
      {...containerProps}
      data-title-bar-chrome-region="interactive"
      className={containerClassName}
    >
      {overlay}
      <button
        ref={buttonRef}
        type="button"
        {...buttonProps}
        className={cn(
          'flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-left text-inherit outline-none disabled:cursor-not-allowed disabled:opacity-70',
          buttonClassName,
        )}
      >
        {children}
      </button>
      {closeProps.closeButton === 'placeholder' ? (
        <ToolbarTabClosePlaceholder />
      ) : closeProps.closeButton !== false ? (
        <ToolbarTabCloseAction
          label={closeProps.closeLabel}
          visible={closeProps.closeVisible}
          disabled={closeProps.closeDisabled ?? false}
          onClose={closeProps.onClose}
        />
      ) : null}
    </div>
  )
}

interface ToolbarTabCloseActionProps {
  label: string
  visible: boolean
  disabled: boolean
  onClose: (event: ToolbarTabCloseEvent) => void
}

const TOOLBAR_TAB_CLOSE_BASE_CLASS =
  'relative z-10 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0.5 text-muted-foreground transition-colors duration-100 before:absolute before:-inset-x-1.5 before:-inset-y-1 before:content-[""] hover:bg-accent hover:text-accent-foreground'

function toolbarTabCloseVisibilityClassName(visible: boolean, disabled: boolean): string {
  if (visible) return disabled ? 'pointer-events-none opacity-100' : 'pointer-events-auto opacity-100'
  if (disabled) return 'pointer-events-none opacity-0'
  return 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100'
}

function stopToolbarTabCloseDragStart(
  event: ReactPointerEvent<HTMLButtonElement> | ReactMouseEvent<HTMLButtonElement>,
) {
  event.stopPropagation()
}

function ToolbarTabClosePlaceholder() {
  return (
    <span
      aria-hidden
      data-toolbar-tab-close-placeholder=""
      className={cn(
        TOOLBAR_TAB_CLOSE_BASE_CLASS,
        'pointer-events-none invisible inline-flex items-center justify-center',
      )}
    >
      <X size={14} />
    </span>
  )
}

function ToolbarTabCloseAction({ label, visible, disabled, onClose }: ToolbarTabCloseActionProps) {
  return (
    // Keep the visible close affordance at its original size while giving
    // the action enough hit slop to match the parent tab hover area.
    <button
      type="button"
      tabIndex={-1}
      aria-label={label}
      disabled={disabled}
      onPointerDown={stopToolbarTabCloseDragStart}
      onMouseDown={stopToolbarTabCloseDragStart}
      onClick={onClose}
      className={cn(TOOLBAR_TAB_CLOSE_BASE_CLASS, toolbarTabCloseVisibilityClassName(visible, disabled))}
      title={label}
    >
      <X size={14} />
    </button>
  )
}
