import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/web/components/ui/dialog.tsx'
interface FormDialogProps extends Omit<React.ComponentProps<typeof DialogContent>, 'children' | 'title'> {
  open: boolean
  onOpenChange?: React.ComponentProps<typeof Dialog>['onOpenChange']
  title: React.ReactNode
  description?: React.ReactNode
  children: React.ReactNode
}

function FormDialog({ open, onOpenChange, title, description, children, ...props }: FormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent {...props}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}

export { FormDialog }
