import { computed, defineComponent, onScopeDispose, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { REPO_MEMBERSHIP_READ_CONFLICT_KEY } from '#/shared/repo-membership-read.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { RepoReadNotificationToast } from '#/web/components/repo-workspace/RepoReadNotificationToast.tsx'
import type { RepoReadNotificationToastProps } from '#/web/components/repo-workspace/RepoReadNotificationToast.tsx'
import { combineRepoReadFailures } from '#/web/repos/read-condition.ts'
import type { RepoReadCondition } from '#/web/repos/read-condition.ts'
import { repoQueryReadFailure } from '#/web/repos/read-failure.ts'
import type { RepoReadFailure } from '#/web/repos/read-failure.ts'
import { useRepoSnapshotReadModel, useRepoWorktreeStatusReadModel } from '#/web/repos/queries.ts'
import { useT } from '#/web/stores/i18n-vue.ts'

interface WorkspaceRepoReadNotificationHostProps {
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
}

interface DesiredRepoReadNotification extends Omit<RepoReadNotificationToastProps, 'onCloseToast'> {
  conditionKey: string
}

interface PresentedToast {
  id: string | number
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
    const dismissedConditionKey = ref<string | null>(null)
    let presentedToast: PresentedToast | null = null
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
        onRetry: currentCondition.retry,
      }
    })

    function retirePresentedToast(): void {
      const currentToast = presentedToast
      if (!currentToast) return
      presentedToast = null
      toast.dismiss(currentToast.id)
    }

    function presentNotification(notification: DesiredRepoReadNotification): void {
      if (presentedToast && presentedToast.conditionKey !== notification.conditionKey) retirePresentedToast()

      const currentToast = presentedToast
      let publishedToastId: string | number | null = currentToast?.id ?? null
      const dismissCurrentCondition = () => {
        if (publishedToastId === null || presentedToast?.id !== publishedToastId) return
        presentedToast = null
        if (conditionKey.value === notification.conditionKey) {
          dismissedConditionKey.value = notification.conditionKey
        }
      }
      publishedToastId = toast.custom(RepoReadNotificationToast, {
        id: currentToast?.id,
        position: 'top-right',
        duration: Number.POSITIVE_INFINITY,
        dismissible: true,
        onDismiss: dismissCurrentCondition,
        class: 'min-[601px]:w-[420px]',
        componentProps: {
          kind: notification.kind,
          title: notification.title,
          description: notification.description,
          retryLabel: notification.retryLabel,
          dismissLabel: notification.dismissLabel,
          retrying: notification.retrying,
          onRetry: notification.onRetry,
        },
      })
      presentedToast = { id: publishedToastId, conditionKey: notification.conditionKey }
    }

    // Query state is authoritative; this watch is the sole imperative boundary
    // that owns the Sonner handle actually returned by toast.custom().
    watch(
      desiredNotification,
      (notification) => {
        if (notification) presentNotification(notification)
        else retirePresentedToast()
      },
      { immediate: true },
    )

    onScopeDispose(retirePresentedToast)
    return () => null
  },
})
