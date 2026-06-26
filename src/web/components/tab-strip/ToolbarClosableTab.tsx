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
    <div ref={containerRef} {...containerProps} data-window-chrome-region="interactive" className={containerClassName}>
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
        <button
          type="button"
          tabIndex={-1}
          aria-label={closeProps.closeLabel}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={closeProps.onClose}
          className={cn(
            'cursor-pointer rounded border-0 bg-transparent p-0.5 text-muted-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground',
            closeProps.closeVisible ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
          )}
          title={closeProps.closeLabel}
        >
          <X size={14} />
        </button>
      )}
    </div>
  )
}
