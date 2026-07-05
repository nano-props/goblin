import { Loader2 } from 'lucide-react'

interface CenteredLoadingStatusProps {
  label?: string
  className?: string
}

export function CenteredLoadingStatus({ label = 'Loading', className = '' }: CenteredLoadingStatusProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex h-full items-center justify-center bg-background text-muted-foreground ${className}`}
    >
      <Loader2 className="size-5 animate-spin" aria-hidden />
      <span className="sr-only">{label}</span>
    </div>
  )
}
