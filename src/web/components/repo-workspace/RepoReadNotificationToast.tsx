import { CircleX, RefreshCw, TriangleAlert, X } from '@lucide/vue'
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import { Button } from '#/web/components/ui/button.tsx'
import { STATUS_TONE_CHIP_CLASS } from '#/web/components/ui/status-tones.ts'
import { cn } from '#/web/lib/cn.ts'
import type { RepoReadCondition } from '#/web/repos/read-condition.ts'

type RepoReadConditionKind = RepoReadCondition['kind']

const ICON_BY_KIND: Record<RepoReadConditionKind, typeof RefreshCw> = {
  'membership-changing': RefreshCw,
  stale: TriangleAlert,
  unavailable: CircleX,
}

const TONE_BY_KIND: Record<RepoReadConditionKind, keyof typeof STATUS_TONE_CHIP_CLASS> = {
  'membership-changing': 'neutral',
  stale: 'warning',
  unavailable: 'danger',
}

const BORDER_CLASS_BY_KIND: Record<RepoReadConditionKind, string> = {
  'membership-changing': 'border-border',
  stale: 'border-warning-border',
  unavailable: 'border-danger-border',
}

export interface RepoReadNotificationToastProps {
  kind: RepoReadConditionKind
  title: string
  description?: string
  retryLabel: string
  dismissLabel: string
  retrying: boolean
  onRetry?: () => void
  onCloseToast?: () => void
}

export const RepoReadNotificationToast = defineComponent<RepoReadNotificationToastProps>({
  name: 'RepoReadNotificationToast',
  props: {
    kind: { type: String as PropType<RepoReadConditionKind>, required: true },
    title: { type: String, required: true },
    description: String,
    retryLabel: { type: String, required: true },
    dismissLabel: { type: String, required: true },
    retrying: { type: Boolean, required: true },
    onRetry: Function as PropType<() => void>,
    onCloseToast: Function as PropType<() => void>,
  },

  setup(props) {
    return () => {
      const NotificationIcon = ICON_BY_KIND[props.kind]
      return (
        <div
          data-testid="repo-read-notification"
          data-kind={props.kind}
          class={cn(
            'flex w-full items-start gap-3 rounded-md border bg-popover p-3 text-popover-foreground shadow-md',
            BORDER_CLASS_BY_KIND[props.kind],
          )}
        >
          <div
            class={cn(
              'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border',
              STATUS_TONE_CHIP_CLASS[TONE_BY_KIND[props.kind]],
            )}
          >
            <NotificationIcon class="size-4" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-xs font-semibold leading-5">{props.title}</div>
            {props.description ? (
              <div class="mt-0.5 break-words text-xs leading-5 text-muted-foreground">{props.description}</div>
            ) : null}
            {props.onRetry ? (
              <div class="mt-2.5">
                <Button type="button" size="sm" variant="outline" disabled={props.retrying} onClick={props.onRetry}>
                  <RefreshCw class={props.retrying ? 'animate-spin' : undefined} />
                  {props.retryLabel}
                </Button>
              </div>
            ) : null}
          </div>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            class="-mr-1 -mt-1 text-muted-foreground"
            aria-label={props.dismissLabel}
            onClick={props.onCloseToast}
          >
            <X />
          </Button>
        </div>
      )
    }
  },
})
