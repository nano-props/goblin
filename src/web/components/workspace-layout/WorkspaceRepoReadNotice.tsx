import { defineComponent } from 'vue'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { RepoReadNotice } from '#/web/components/RepoReadNotice.tsx'
import { repoQueryReadFailure } from '#/web/repos/read-failure.ts'
import type { RepoReadFailure } from '#/web/repos/read-failure.ts'
import { useRepoSnapshotReadModel, useRepoWorktreeStatusReadModel } from '#/web/repos/queries.ts'

interface WorkspaceRepoReadNoticeProps {
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
}

export const WorkspaceRepoReadNotice = defineComponent<WorkspaceRepoReadNoticeProps>({
  name: 'WorkspaceRepoReadNotice',
  props: ['workspaceId', 'workspaceRuntimeId'],

  setup(props) {
    const snapshot = useRepoSnapshotReadModel(
      () => props.workspaceId,
      () => props.workspaceRuntimeId,
    )
    const status = useRepoWorktreeStatusReadModel(
      () => props.workspaceId,
      () => props.workspaceRuntimeId,
    )

    return () => {
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
      const failures = [
        snapshotFailure?.stale ? snapshotFailure : null,
        snapshot.data.value ? statusFailure : null,
      ].filter((failure): failure is RepoReadFailure => failure !== null)

      return <RepoReadNotice failures={failures} />
    }
  },
})
