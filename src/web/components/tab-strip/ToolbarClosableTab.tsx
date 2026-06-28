import { X } from 'lucide-react'
import type { ComponentPropsWithoutRef, ReactNode, Ref } from 'react'
import { cn } from '#/web/lib/cn.ts'

type DataAttributes = {
  [K in `data-${string}`]?: string | boolean | undefined
}

type ToolbarClosableTabContainerProps = Omit<ComponentPropsWithoutRef<'div'>, 'children' | 'className'> & DataAttributes
type ToolbarClosableTabButtonProps = Omit<ComponentPropsWithoutRef<'button'>, 'children' | 'className' | 'ref'> &
  DataAttributes

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
        closeButton?: true
        onClose: (event: React.MouseEvent<HTMLButtonElement>) => void
      }
    | {
        closeButton: false
        closeLabel?: never
        closeVisible?: never
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
          'flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-left text-inherit outline-none',
          buttonClassName,
        )}
      >
        {children}
      </button>
      {closeProps.closeButton !== false && (
        // Keep the visible close affordance at its original size while giving
        // the action enough hit slop to match the parent tab hover area.
        <button
          type="button"
          tabIndex={-1}
          aria-label={closeProps.closeLabel}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={closeProps.onClose}
          className={cn(
            'relative z-10 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0.5 text-muted-foreground transition-colors duration-100 before:absolute before:-inset-x-1.5 before:-inset-y-1 before:content-[""] hover:bg-accent hover:text-accent-foreground',
            closeProps.closeVisible
              ? 'pointer-events-auto opacity-100'
              : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100',
          )}
          title={closeProps.closeLabel}
        >
          <X size={14} />
        </button>
      )}
    </div>
  )
}
