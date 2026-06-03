import type { ComponentPropsWithoutRef, ElementType } from 'react'
import { cn } from '#/web/lib/cn.ts'

type PanelProps<T extends ElementType = 'div'> = {
  as?: T
  className?: string
} & Omit<ComponentPropsWithoutRef<T>, 'as' | 'className'>

function Panel<T extends ElementType = 'div'>({ as, className, ...props }: PanelProps<T>) {
  const Comp = (as ?? 'div') as ElementType
  return (
    <Comp
      className={cn(
        'overflow-hidden rounded-xl border border-border/60 bg-background/85 shadow-[var(--shadow-inset-highlight)]',
        className,
      )}
      {...props}
    />
  )
}

function PanelHeader({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cn('flex items-center justify-between border-b border-border/60 px-3 py-2', className)} {...props} />
}

function PanelBody({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cn('px-3 py-3', className)} {...props} />
}

function PanelInset({
  className,
  tone = 'default',
  size = 'md',
  ...props
}: ComponentPropsWithoutRef<'div'> & {
  tone?: 'default' | 'muted' | 'subtle' | 'dashed'
  size?: 'sm' | 'md' | 'lg'
}) {
  return (
    <div
      className={cn(
        'rounded-md border',
        tone === 'default' && 'border-border/50 bg-background/60',
        tone === 'muted' && 'border-border/60 bg-muted/20',
        tone === 'subtle' && 'border-border/60 bg-muted/15',
        tone === 'dashed' && 'border-dashed border-border bg-transparent',
        size === 'sm' && 'px-2.5 py-2',
        size === 'md' && 'px-3 py-2',
        size === 'lg' && 'px-4 py-3',
        className,
      )}
      {...props}
    />
  )
}

export { Panel, PanelBody, PanelHeader, PanelInset }
