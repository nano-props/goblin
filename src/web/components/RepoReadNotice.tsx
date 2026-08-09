import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import { RepoReadFailureNotice, RepoStatusStaleNotice } from '#/web/components/RepoStatusFailureView.tsx'
import type { RepoReadFailure } from '#/web/repo-read-failure.ts'

interface RepoReadNoticePresentation {
  message: string
  stale: boolean
  retrying: boolean
  retry?: () => void
}

function projectRepoReadNotice(failures: readonly RepoReadFailure[]): RepoReadNoticePresentation | null {
  const firstFailure = failures[0]
  if (!firstFailure) return null

  const message = failures.every((failure) => failure.message === firstFailure.message)
    ? firstFailure.message
    : 'error.failed-read-repo'
  const idleRetries: Array<() => void> = []
  let hasRetry = false
  for (const { retry, retrying } of failures) {
    if (!retry) continue
    hasRetry = true
    if (!retrying) idleRetries.push(retry)
  }

  return {
    message,
    stale: failures.every((failure) => failure.stale),
    retrying: hasRetry && idleRetries.length === 0,
    retry: hasRetry
      ? () => {
          for (const retry of idleRetries) retry()
        }
      : undefined,
  }
}

export const RepoReadNotice = defineComponent<{ failures: readonly RepoReadFailure[] }>({
  name: 'RepoReadNotice',
  props: {
    failures: { type: Array as PropType<readonly RepoReadFailure[]>, required: true },
  },

  setup(props) {
    return () => {
      const presentation = projectRepoReadNotice(props.failures)
      if (!presentation) return null
      return presentation.stale ? (
        <RepoStatusStaleNotice
          messageKey={presentation.message}
          retrying={presentation.retrying}
          onRetry={presentation.retry}
        />
      ) : (
        <RepoReadFailureNotice
          messageKey={presentation.message}
          retrying={presentation.retrying}
          onRetry={presentation.retry}
        />
      )
    }
  },
})
