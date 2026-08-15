import { computed, defineComponent, ref, Teleport } from 'vue'
import { REPO_MEMBERSHIP_READ_CONFLICT_KEY } from '#/shared/repo-membership-read.ts'
import { TITLE_BAR_HEIGHT_PX } from '#/shared/title-bar-chrome.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { RepoReadNotificationCard } from '#/web/components/repo-workspace/RepoReadNotificationCard.tsx'
import type { RepoReadNotificationCardProps } from '#/web/components/repo-workspace/RepoReadNotificationCard.tsx'
import { combineRepoReadFailures } from '#/web/repos/read-condition.ts'
import type { RepoReadCondition } from '#/web/repos/read-condition.ts'
import { repoQueryReadFailure } from '#/web/repos/read-failure.ts'
import type { RepoReadFailure } from '#/web/repos/read-failure.ts'
import { useRepoSnapshotReadModel, useRepoWorktreeStatusReadModel } from '#/web/repos/queries.ts'
import { useWorkspaceRuntimeRecoveryActions } from '#/web/runtime/workspace-runtime-recovery-context.ts'
import { useT } from '#/web/stores/i18n-vue.ts'

interface WorkspaceRepoReadNotificationHostProps {
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
}

interface DesiredRepoReadNotification extends Omit<RepoReadNotificationCardProps, 'onDismiss'> {
  conditionKey: string
}

const TITLE_KEY_BY_CONDITION: Record<RepoReadCondition['kind'], string> = {
  'membership-changing': REPO_MEMBERSHIP_READ_CONFLICT_KEY,
  stale: 'status.stale-title',
  unavailable: 'error.failed-read-repo',
}
export const WorkspaceRepoReadNotificationHost = defineComponent<WorkspaceRepoReadNotificationHostProps>({
  name: 'WorkspaceRepoReadNotificationHost',
  props: ['workspaceId', 'workspaceRuntimeId'],

  setup(props) {
    const t = useT()
    const runtimeRecovery = useWorkspaceRuntimeRecoveryActions()
    const dismissedConditionKey = ref<string | null>(null)
    const snapshot = useRepoSnapshotReadModel(
      () => props.workspaceId,
      () => props.workspaceRuntimeId,
    )
    const status = useRepoWorktreeStatusReadModel(
      () => props.workspaceId,
      () => props.workspaceRuntimeId,
    )
    const failures = computed<readonly RepoReadFailure[]>(() => {
      const snapshotFailure = repoQueryReadFailure(
        {
          isError: snapshot.isError.value,
          error: snapshot.error.value,
          isFetching: snapshot.isFetching.value,
          data: snapshot.data.value,
        },
        () => void snapshot.refetch(),
      )
      const statusFailure = repoQueryReadFailure(
        {
          isError: status.isError.value,
          error: status.error.value,
          isFetching: status.isFetching.value,
          data: status.data.value,
        },
        () => void status.refetch(),
      )
      return [snapshotFailure?.stale ? snapshotFailure : null, snapshot.data.value ? statusFailure : null].filter(
        (failure): failure is RepoReadFailure => failure !== null,
      )
    })
    const condition = computed(() => combineRepoReadFailures(failures.value))
    const conditionKey = computed(() => {
      const currentCondition = condition.value
      if (!currentCondition) return null
      return [
        props.workspaceId,
        props.workspaceRuntimeId,
        currentCondition.kind,
        currentCondition.message,
        snapshot.errorUpdatedAt.value,
        status.errorUpdatedAt.value,
      ].join('\0')
    })
    const desiredNotification = computed<DesiredRepoReadNotification | null>(() => {
      const currentCondition = condition.value
      const currentConditionKey = conditionKey.value
      if (!currentCondition || !currentConditionKey || dismissedConditionKey.value === currentConditionKey) {
        return null
      }
      const titleKey = TITLE_KEY_BY_CONDITION[currentCondition.kind]
      return {
        conditionKey: currentConditionKey,
        kind: currentCondition.kind,
        title: t(titleKey),
        description: currentCondition.message === titleKey ? undefined : t(currentCondition.message),
        retryLabel: t('error.try-again'),
        dismissLabel: t('status.dismiss-notification'),
        retrying: currentCondition.retrying,
        onRetry: failures.value.some((failure) => failure.message === 'error.workspace-runtime-stale')
          ? runtimeRecovery.request
          : currentCondition.retry,
      }
    })

    return () => {
      const notification = desiredNotification.value
      if (!notification) return null
      return (
        <Teleport to="body">
          <div
            data-testid="workspace-repo-read-notification"
            role={notification.kind === 'unavailable' ? 'alert' : 'status'}
            aria-live={notification.kind === 'unavailable' ? 'assertive' : 'polite'}
            class="fixed left-4 right-4 z-40 min-[601px]:left-auto min-[601px]:w-[420px]"
            style={{ top: `${TITLE_BAR_HEIGHT_PX + 12}px` }}
          >
            <RepoReadNotificationCard
              kind={notification.kind}
              title={notification.title}
              description={notification.description}
              retryLabel={notification.retryLabel}
              dismissLabel={notification.dismissLabel}
              retrying={notification.retrying}
              onRetry={notification.onRetry}
              onDismiss={() => {
                if (conditionKey.value === notification.conditionKey) {
                  dismissedConditionKey.value = notification.conditionKey
                }
              }}
            />
          </div>
        </Teleport>
      )
    }
  },
})
