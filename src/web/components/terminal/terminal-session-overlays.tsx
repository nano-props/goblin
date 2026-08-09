import { defineComponent, ref } from 'vue'
import type { FunctionalComponent } from 'vue'
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
export const EmptyTerminalCta = defineComponent<EmptyTerminalCtaProps>({
  name: 'EmptyTerminalCta',
  props: ['onCreate', 'emptyLabel', 'newTerminalLabel'],
  setup(props) {
    const creating = ref(false)

    async function create(): Promise<void> {
      if (creating.value) return
      creating.value = true
      try {
        await props.onCreate()
      } finally {
        creating.value = false
      }
    }

    return () => (
      <div class="goblin-terminal-session__empty-cta" role="region" aria-label={props.emptyLabel}>
        <div class="goblin-terminal-session__empty-message">
          <span class="goblin-terminal-session__empty-title">{props.emptyLabel}</span>
        </div>
        <Button type="button" size="sm" variant="secondary" onClick={() => void create()} disabled={creating.value}>
          {creating.value ? `${props.newTerminalLabel}…` : props.newTerminalLabel}
        </Button>
      </div>
    )
  },
})

interface StatusOverlayProps {
  label: string
}

// Hoisted so clsx + tailwind-merge don't re-allocate per render.
const STATUS_DOT_CLASS = cn('goblin-terminal-session__status-dot', 'animate-pulse')

// Transient status chip rendered while a terminal is opening or
// restarting. Its parent owns the aria-live visibility contract; this
// component keeps the live-region node stable while its label changes.
export const StatusOverlay: FunctionalComponent<StatusOverlayProps> = (props) => {
  return (
    <div class="goblin-terminal-session__status-overlay" role="status" aria-live="polite" aria-busy="true">
      <span class={STATUS_DOT_CLASS} />
      <span>{props.label}</span>
    </div>
  )
}
StatusOverlay.props = ['label']

export const AttachmentOverlay: FunctionalComponent<AttachmentOverlayProps> = (props) => {
  return (
    <div class="goblin-terminal-session__viewer-overlay">
      <div class="goblin-terminal-session__viewer-content">
        <div class="goblin-terminal-session__viewer-badge">{props.badge}</div>
        <div class="goblin-terminal-session__viewer-meta">
          <span class="goblin-terminal-session__viewer-process">{props.snapshot.processName}</span>
          {props.snapshot.canonicalTitle ? (
            <span class="goblin-terminal-session__viewer-title">{props.snapshot.canonicalTitle}</span>
          ) : null}
        </div>
        {props.takeover ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              if (props.takeover?.terminalSessionId) props.takeover.run(props.takeover.terminalSessionId)
            }}
            disabled={!props.takeover.terminalSessionId || props.takeover.pending}
            aria-busy={props.takeover.pending || undefined}
          >
            {props.takeover.pending ? props.takeover.pendingLabel : props.takeover.label}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
AttachmentOverlay.props = ['badge', 'snapshot', 'takeover']

interface PresentationFailureOverlayProps {
  label: string
  retryLabel?: string
  onRetry?: () => void
}

export const PresentationFailureOverlay: FunctionalComponent<PresentationFailureOverlayProps> = (props) => {
  return (
    <div
      class="goblin-terminal-session__status-overlay goblin-terminal-session__status-overlay--error"
      role="alert"
      aria-live="polite"
      aria-atomic="true"
    >
      <span>{props.label}</span>
      {props.retryLabel && props.onRetry ? (
        <Button type="button" size="sm" variant="ghost" onClick={props.onRetry}>
          {props.retryLabel}
        </Button>
      ) : null}
    </div>
  )
}
PresentationFailureOverlay.props = ['label', 'retryLabel', 'onRetry']
