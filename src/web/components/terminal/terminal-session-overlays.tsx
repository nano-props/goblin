import { useCallback, useState } from 'react'
import { Button } from '#/web/components/ui/button.tsx'
import { cn } from '#/web/lib/cn.ts'
import type { TerminalSnapshot } from '#/web/components/terminal/types.ts'

interface AttachmentOverlayProps {
  badge: string
  snapshot: TerminalSnapshot
  takeover?: {
    label: string
    pendingLabel: string
    terminalSessionId: string | null
    pending?: boolean
    run: (terminalSessionId: string) => void
  }
}

interface EmptyTerminalCtaProps {
  onCreate: () => Promise<void> | void
  emptyLabel: string
  newTerminalLabel: string
}

// Empty-state CTA. Rendered when the filesystem target has no terminal
// sessions yet. The button is the only way for the user to
// materialize a session on a fresh target without reaching for
// the per-target "+" affordance in the tab strip — the session's
// bare host <div> would otherwise be a featureless black box, which
// is the "blank screen" symptom the user reported on first click.
//
// `creating` is local to the button so double-clicks don't enqueue
// a second create while the first one is in flight. The registry's
// pending-create queue would dedupe the second call by filesystem-target
// key, but a visible loading state is still the right user signal.
export function EmptyTerminalCta({ onCreate, emptyLabel, newTerminalLabel }: EmptyTerminalCtaProps) {
  const [creating, setCreating] = useState(false)
  const handleClick = useCallback(async () => {
    if (creating) return
    setCreating(true)
    try {
      await onCreate()
    } finally {
      setCreating(false)
    }
  }, [creating, onCreate])
  return (
    <div className="goblin-terminal-session__empty-cta" role="region" aria-label={emptyLabel}>
      <div className="goblin-terminal-session__empty-message">
        <span className="goblin-terminal-session__empty-title">{emptyLabel}</span>
      </div>
      <Button type="button" size="sm" variant="secondary" onClick={handleClick} disabled={creating}>
        {creating ? `${newTerminalLabel}…` : newTerminalLabel}
      </Button>
    </div>
  )
}

interface StatusOverlayProps {
  label: string
}

// Hoisted so clsx + tailwind-merge don't re-allocate per render.
const STATUS_DOT_CLASS = cn('goblin-terminal-session__status-dot', 'animate-pulse')

// Transient status chip rendered while a terminal is opening or
// restarting. Its parent owns the aria-live visibility contract; this
// component keeps the live-region node stable while its label changes.
export function StatusOverlay({ label }: StatusOverlayProps) {
  return (
    <div className="goblin-terminal-session__status-overlay" role="status" aria-live="polite" aria-busy="true">
      <span className={STATUS_DOT_CLASS} />
      <span>{label}</span>
    </div>
  )
}

export function AttachmentOverlay({ badge, snapshot, takeover }: AttachmentOverlayProps) {
  return (
    <div className="goblin-terminal-session__viewer-overlay">
      <div className="goblin-terminal-session__viewer-content">
        <div className="goblin-terminal-session__viewer-badge">{badge}</div>
        <div className="goblin-terminal-session__viewer-meta">
          <span className="goblin-terminal-session__viewer-process">{snapshot.processName}</span>
          {snapshot.canonicalTitle && (
            <span className="goblin-terminal-session__viewer-title">{snapshot.canonicalTitle}</span>
          )}
        </div>
        {takeover && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => takeover.terminalSessionId && takeover.run(takeover.terminalSessionId)}
            disabled={!takeover.terminalSessionId || takeover.pending}
            aria-busy={takeover.pending || undefined}
          >
            {takeover.pending ? takeover.pendingLabel : takeover.label}
          </Button>
        )}
      </div>
    </div>
  )
}

export function PresentationFailureOverlay({
  label,
  retryLabel,
  onRetry,
}: {
  label: string
  retryLabel?: string
  onRetry?: () => void
}) {
  return (
    <div
      className="goblin-terminal-session__status-overlay goblin-terminal-session__status-overlay--error"
      role="alert"
      aria-live="polite"
      aria-atomic="true"
    >
      <span>{label}</span>
      {retryLabel && onRetry && (
        <Button type="button" size="sm" variant="ghost" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  )
}
