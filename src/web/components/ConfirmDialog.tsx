// Confirm dialog for destructive operations (push to a protected
// branch, checkout with dirty tree). Built on shadcn/ui AlertDialog
// rather than Dialog so it gets the right semantics for AT users:
//   - role=alertdialog (vs role=dialog)
//   - focus lands on the cancel action by default, not the confirm
//   - Esc + outside-click both cancel
// The `destructive` flag swaps the confirm button's variant so an
// irreversible action reads as red rather than neutral.
import { Loader2 } from 'lucide-react'

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#/web/components/ui/alert-dialog.tsx'
import { Button } from '#/web/components/ui/button.tsx'
import { useT } from '#/web/stores/i18n.ts'
import { useAsyncPending } from '#/web/hooks/useAsyncPending.ts'

interface Props {
  open: boolean
  title: string
  message: React.ReactNode
  confirmLabel: string
  /** Renders the confirm button red. Use for genuinely irreversible ops. */
  destructive?: boolean
  onCancel: () => void
  onConfirm: () => void | Promise<void>
}

export function ConfirmDialog({ open, title, message, confirmLabel, destructive, onCancel, onConfirm }: Props) {
  const t = useT()
  const { isPending, run } = useAsyncPending<'confirm'>()

  function handleConfirm() {
    void run('confirm', onConfirm)
  }

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && !isPending && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {/* AlertDialogDescription wants string or inline content; we
           * pass arbitrary ReactNode so we render the body as a child
           * of the description for AT, but keep ours rich-content. */}
          <AlertDialogDescription asChild>
            <div className="text-sm text-muted-foreground leading-relaxed">{message}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending} onClick={onCancel}>
            {t('dialog.cancel')}
          </AlertDialogCancel>
          <Button
            size="sm"
            variant={destructive ? 'destructive' : 'default'}
            disabled={isPending}
            aria-busy={isPending ? true : undefined}
            onClick={handleConfirm}
          >
            {isPending && <Loader2 className="animate-spin" />}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
