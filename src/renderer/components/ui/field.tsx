import * as React from 'react'

import { cn } from '#/renderer/lib/cn.ts'

function Field({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="field" className={cn('grid gap-1', className)} {...props} />
}

function FieldLabel({ className, ...props }: React.ComponentProps<'label'>) {
  return <label data-slot="field-label" className={cn('text-sm font-medium text-foreground', className)} {...props} />
}

type FieldTextProps = React.ComponentProps<'div'> & {
  reserveHeight?: boolean
}

function FieldDescription({ className, reserveHeight = false, ...props }: FieldTextProps) {
  return (
    <div
      data-slot="field-description"
      className={cn(reserveHeight && 'min-h-4', 'text-xs leading-4 text-muted-foreground', className)}
      {...props}
    />
  )
}

function FieldError({ className, reserveHeight = false, ...props }: FieldTextProps) {
  return (
    <div
      data-slot="field-error"
      className={cn(reserveHeight && 'min-h-4', 'text-xs leading-4 text-danger', className)}
      {...props}
    />
  )
}

export { Field, FieldDescription, FieldError, FieldLabel }
