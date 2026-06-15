import { X } from 'lucide-react'
import type { ComponentPropsWithoutRef, ReactNode, Ref } from 'react'
import { cn } from '#/web/lib/cn.ts'

type DataAttributes = {
  [K in `data-${string}`]?: string | boolean | undefined
}

type ToolbarClosableTabContainerProps = Omit<ComponentPropsWithoutRef<'div'>, 'children' | 'className'> & DataAttributes
type ToolbarClosableTabButtonProps = Omit<ComponentPropsWithoutRef<'button'>, 'children' | 'className' | 'ref'> &
  DataAttributes

interface ToolbarClosableTabProps {
  containerRef?: Ref<HTMLDivElement>
  containerProps?: ToolbarClosableTabContainerProps
  containerClassName: string
  overlay?: ReactNode
  buttonRef?: Ref<HTMLButtonElement>
  buttonProps?: ToolbarClosableTabButtonProps
  buttonClassName?: string
  closeLabel: string
  closeVisible: boolean
  onClose: (event: React.MouseEvent<HTMLButtonElement>) => void
  children: ReactNode
}

export function ToolbarClosableTab({
  containerRef,
  containerProps,
  containerClassName,
  overlay,
  buttonRef,
  buttonProps,
  buttonClassName,
  closeLabel,
  closeVisible,
  onClose,
  children,
}: ToolbarClosableTabProps) {
  return (
    <div ref={containerRef} {...containerProps} className={containerClassName}>
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
      <button
        type="button"
        tabIndex={-1}
        aria-label={closeLabel}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={onClose}
        className={cn(
          'cursor-pointer rounded border-0 bg-transparent p-0.5 text-muted-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground',
          closeVisible ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
        )}
        title={closeLabel}
      >
        <X size={14} />
      </button>
    </div>
  )
}
