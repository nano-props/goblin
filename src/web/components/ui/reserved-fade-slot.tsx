import type { ReactNode } from 'react'
import { cn } from '#/web/lib/cn.ts'

interface ReservedFadeSlotProps {
  children: ReactNode
  present: boolean
  className?: string
  contentClassName?: string
}

export function ReservedFadeSlot({ children, present, className, contentClassName }: ReservedFadeSlotProps) {
  return (
    <div className={cn('overflow-hidden', className)}>
      <div
        aria-hidden={!present}
        inert={!present || undefined}
        className={cn(
          'transition-opacity duration-200 ease-in-out',
          present ? 'opacity-100' : 'pointer-events-none opacity-0',
          contentClassName,
        )}
      >
        {children}
      </div>
    </div>
  )
}
