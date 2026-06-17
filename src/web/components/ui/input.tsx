import * as React from 'react'
import { cn } from '#/web/lib/cn.ts'
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        ref={ref}
        data-slot="input"
        type={type}
        className={cn(
          // focus:ring-inset keeps the focus ring inside the border box, so
          // ancestor overflow:hidden (e.g. AnimateHeight during height
          // transitions) can't clip it. Concentric outer rings are
          // fundamentally clip-fragile.
          'h-9 w-full rounded-md border border-input bg-control px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-inset focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-danger-border aria-invalid:ring-danger/20 dark:aria-invalid:ring-danger/40',
          className,
        )}
        {...props}
      />
    )
  },
)

Input.displayName = 'Input'

export { Input }
