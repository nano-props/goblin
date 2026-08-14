import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import {
  RepoMembershipChangingNotice,
  RepoReadFailureNotice,
  RepoStatusStaleNotice,
} from '#/web/components/RepoStatusFailureView.tsx'
import { combineRepoReadFailures } from '#/web/repos/read-condition.ts'
import type { RepoReadFailure } from '#/web/repos/read-failure.ts'

export const RepoReadNotice = defineComponent<{ failures: readonly RepoReadFailure[] }>({
  name: 'RepoReadNotice',
  props: {
    failures: { type: Array as PropType<readonly RepoReadFailure[]>, required: true },
  },

  setup(props) {
    return () => {
      const condition = combineRepoReadFailures(props.failures)
      if (!condition) return null
      if (condition.kind === 'membership-changing') {
        return <RepoMembershipChangingNotice retrying={condition.retrying} onRetry={condition.retry} />
      }
      return condition.kind === 'stale' ? (
        <RepoStatusStaleNotice messageKey={condition.message} retrying={condition.retrying} onRetry={condition.retry} />
      ) : (
        <RepoReadFailureNotice messageKey={condition.message} retrying={condition.retrying} onRetry={condition.retry} />
      )
    }
  },
})
