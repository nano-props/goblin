import * as React from 'react'
import { STATUS_TONE_CHIP_CLASS } from '#/web/components/ui/status-tones.ts'
import { cn } from '#/web/lib/cn.ts'
function DialogError({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      role="alert"
      aria-live="polite"
      aria-atomic="true"
      data-slot="dialog-error"
      className={cn(
        'mt-3 rounded-md px-3 py-2 text-xs leading-relaxed [overflow-wrap:anywhere]',
        STATUS_TONE_CHIP_CLASS.danger,
        className,
      )}
      {...props}
    />
  )
}

export { DialogError }
