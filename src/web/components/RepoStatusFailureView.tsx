import { AlertCircle, RefreshCw } from '@lucide/vue'
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import { REPO_MEMBERSHIP_READ_CONFLICT_KEY } from '#/shared/repo-membership-read.ts'
import { EmptyState } from '#/web/components/Layout.tsx'
import { Button } from '#/web/components/ui/button.tsx'
import { useT } from '#/web/stores/i18n-vue.ts'

interface RepoStatusFailureViewProps {
  messageKey: string
  retrying: boolean
  onRetry: () => void
}

export const RepoStatusFailureView = defineComponent<RepoStatusFailureViewProps>({
  name: 'RepoStatusFailureView',
  props: {
    messageKey: { type: String, required: true },
    retrying: { type: Boolean, required: true },
    onRetry: { type: Function as PropType<() => void>, required: true },
  },

  setup(props) {
    const t = useT()
    return () => {
      if (props.messageKey === REPO_MEMBERSHIP_READ_CONFLICT_KEY) {
        return <RepoMembershipChangingView retrying={props.retrying} onRetry={props.onRetry} />
      }
      const showDetail = props.messageKey !== 'error.failed-read-repo'
      return (
        <div role="alert" class="flex min-h-0 flex-1">
          <EmptyState
            icon={<AlertCircle size={18} />}
            title={t('error.failed-read-repo')}
            body={
              <div class="space-y-3">
                {showDetail ? <div class="break-words">{t(props.messageKey)}</div> : null}
                <Button type="button" variant="default" disabled={props.retrying} onClick={props.onRetry}>
                  <RefreshCw class={props.retrying ? 'animate-spin' : undefined} />
                  {t('error.try-again')}
                </Button>
              </div>
            }
          />
        </div>
      )
    }
  },
})

interface RepoStatusNoticeProps {
  messageKey: string
  retrying?: boolean
  onRetry?: () => void
}

export const RepoStatusStaleNotice = defineComponent<RepoStatusNoticeProps>({
  name: 'RepoStatusStaleNotice',
  props: {
    messageKey: { type: String, required: true },
    retrying: Boolean,
    onRetry: Function as PropType<() => void>,
  },

  setup(props) {
    const t = useT()
    return () => {
      if (props.messageKey === REPO_MEMBERSHIP_READ_CONFLICT_KEY) {
        return <RepoMembershipChangingNotice retrying={props.retrying} onRetry={props.onRetry} />
      }
      return (
        <div
          role="status"
          class="flex items-center justify-between gap-3 border-b border-warning-border bg-warning-surface px-4 py-2 text-xs text-warning"
        >
          <div class="min-w-0">
            <span class="font-medium">{t('status.stale-title')}</span>
            <span class="break-words text-muted-foreground">
              {' — '}
              {t(props.messageKey)}
            </span>
          </div>
          {props.onRetry ? (
            <Button type="button" size="sm" variant="ghost" disabled={props.retrying} onClick={props.onRetry}>
              <RefreshCw class={props.retrying ? 'animate-spin' : undefined} />
              {t('error.try-again')}
            </Button>
          ) : null}
        </div>
      )
    }
  },
})

export const RepoReadFailureNotice = defineComponent<RepoStatusNoticeProps>({
  name: 'RepoReadFailureNotice',
  props: {
    messageKey: { type: String, required: true },
    retrying: Boolean,
    onRetry: Function as PropType<() => void>,
  },

  setup(props) {
    const t = useT()
    return () => {
      if (props.messageKey === REPO_MEMBERSHIP_READ_CONFLICT_KEY) {
        return <RepoMembershipChangingNotice retrying={props.retrying} onRetry={props.onRetry} />
      }
      return (
        <div
          role="alert"
          class="flex items-center justify-between gap-3 border-b border-destructive/30 bg-destructive/5 px-4 py-2 text-xs text-destructive"
        >
          <span class="min-w-0 break-words">{t(props.messageKey)}</span>
          {props.onRetry ? (
            <Button type="button" size="sm" variant="ghost" disabled={props.retrying} onClick={props.onRetry}>
              <RefreshCw class={props.retrying ? 'animate-spin' : undefined} />
              {t('error.try-again')}
            </Button>
          ) : null}
        </div>
      )
    }
  },
})

const RepoMembershipChangingView = defineComponent<{ retrying: boolean; onRetry: () => void }>({
  name: 'RepoMembershipChangingView',
  props: {
    retrying: { type: Boolean, required: true },
    onRetry: { type: Function as PropType<() => void>, required: true },
  },

  setup(props) {
    const t = useT()
    return () => (
      <div role="status" class="flex min-h-0 flex-1">
        <EmptyState
          icon={<RefreshCw size={18} />}
          title={t(REPO_MEMBERSHIP_READ_CONFLICT_KEY)}
          body={
            <Button type="button" variant="default" disabled={props.retrying} onClick={props.onRetry}>
              <RefreshCw class={props.retrying ? 'animate-spin' : undefined} />
              {t('error.try-again')}
            </Button>
          }
        />
      </div>
    )
  },
})

const RepoMembershipChangingNotice = defineComponent<{ retrying?: boolean; onRetry?: () => void }>({
  name: 'RepoMembershipChangingNotice',
  props: {
    retrying: Boolean,
    onRetry: Function as PropType<() => void>,
  },

  setup(props) {
    const t = useT()
    return () => (
      <div
        role="status"
        class="flex items-center justify-between gap-3 border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground"
      >
        <span class="min-w-0 break-words">{t(REPO_MEMBERSHIP_READ_CONFLICT_KEY)}</span>
        {props.onRetry ? (
          <Button type="button" size="sm" variant="ghost" disabled={props.retrying} onClick={props.onRetry}>
            <RefreshCw class={props.retrying ? 'animate-spin' : undefined} />
            {t('error.try-again')}
          </Button>
        ) : null}
      </div>
    )
  },
})
