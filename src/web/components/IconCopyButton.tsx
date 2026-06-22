import { Check, Copy, Loader2 } from 'lucide-react'
import { Button } from '#/web/components/ui/button.tsx'
import { Tip } from '#/web/components/Tip.tsx'
import { cn } from '#/web/lib/cn.ts'

// Visual primitive for a copy-to-clipboard affordance: an icon-only
// button that swaps Copy → Loader2 (busy) → Check (succeeded) and
// keeps its tooltip pinned open while the success state is on screen.
// Callers drive `succeeded` and `busy` from their own state — this
// component is purely presentational so the same look lives on both
// the bare `CopyButton` and richer widgets like `StatusCopyPatchButton`.
interface Props {
  label: string
  succeeded: boolean
  busy?: boolean
  disabled?: boolean
  side?: 'top' | 'right' | 'bottom' | 'left'
  className?: string
  onClick: () => void
}

export function IconCopyButton({
  label,
  succeeded,
  busy,
  disabled,
  side = 'right',
  className,
  onClick,
}: Props) {
  return (
    <Tip label={label} side={side} forceOpen={succeeded}>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        disabled={disabled}
        aria-busy={busy || undefined}
        aria-label={label}
        onClick={onClick}
        className={cn('text-muted-foreground hover:text-foreground', className)}
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : succeeded ? <Check size={12} /> : <Copy size={12} />}
      </Button>
    </Tip>
  )
}
