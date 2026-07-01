import * as React from 'react'
import { cn } from '#/web/lib/cn.ts'
import { focusRingInset } from '#/web/components/ui/focus.ts'

function Input({ className, type, ref, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      ref={ref}
      data-slot="input"
      type={type}
      className={cn(
        'h-9 w-full rounded-md border border-input bg-control px-3 py-2 text-sm focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-danger-border aria-invalid:ring-danger/20 dark:aria-invalid:ring-danger/40',
        focusRingInset,
        className,
      )}
      {...props}
    />
  )
}

export { Input }
