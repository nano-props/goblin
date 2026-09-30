import { defineComponent, onMounted, onScopeDispose, ref } from 'vue'
import { useRouter } from 'vue-router'
import * as v from 'valibot'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { WorkspaceOpenPathSchema } from '#/shared/workspace-open-url.ts'
import { workspaceSlugFromId } from '#/web/app/navigation/workspace-route-slugs.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import { reportOpenWorkspacePostOpenEffects } from '#/web/lib/open-workspace-result-feedback.ts'
import { EmptyState } from '#/web/components/EmptyState.tsx'
import { Button } from '#/web/components/ui/button.tsx'

// Mounted by the authenticated, restored shell. The route keys this page by
// URL so a different directory has a fresh action lifetime.
export const WorkspaceOpenPage = defineComponent<{ path: unknown }>({
  name: 'WorkspaceOpenPage',
  props: ['path'],
  setup(props) {
    const router = useRouter()
    const t = useT()
    const pending = ref(false)
    const error = ref<string | null>(null)
    const openedWorkspaceId = ref<WorkspaceId | null>(null)
    const directory = v.safeParse(WorkspaceOpenPathSchema, props.path)
    let disposed = false
    onScopeDispose(() => {
      disposed = true
    })

    async function open(): Promise<void> {
      if (pending.value || disposed) return
      if (!directory.success) {
        error.value = t('workspace-open.invalid-path')
        return
      }
      pending.value = true
      error.value = null
      try {
        if (!openedWorkspaceId.value) {
          const result = await workspacesStore.getState().openWorkspaceMembership(directory.output)
          if (disposed) return
          if (!result.ok) {
            error.value = t(result.message)
            return
          }
          openedWorkspaceId.value = result.workspaceId
          reportOpenWorkspacePostOpenEffects(result, t)
        }
        const target = { name: 'workspace', params: { workspaceSlug: workspaceSlugFromId(openedWorkspaceId.value) } }
        const failure = await router.replace(target)
        if (failure && !disposed) error.value = t('workspace-picker.open-presentation-failed')
      } catch (caught) {
        if (!disposed) {
          const titleKey = openedWorkspaceId.value
            ? 'workspace-picker.open-presentation-failed'
            : 'error.workspace-open-failed'
          const detail = caught instanceof Error ? caught.message : t('error.unknown')
          error.value = `${t(titleKey)}: ${detail}`
        }
      } finally {
        pending.value = false
      }
    }

    onMounted(() => void open())
    return () => (
      <EmptyState
        title={t('workspace-picker.open-title')}
        body={
          <div class="space-y-3 pt-2">
            {directory.success && <p class="max-w-lg break-all">{directory.output}</p>}
            {error.value ? (
              <p role="alert">{error.value}</p>
            ) : (
              <p role="status">{t('workspace-picker.open-opening')}</p>
            )}
            <div class="flex justify-center gap-2">
              {error.value && directory.success && (
                <Button disabled={pending.value} onClick={() => void open()}>
                  {t('workspace-open.retry')}
                </Button>
              )}
              <Button variant="outline" onClick={() => void router.replace({ name: 'home' })}>
                {t('route.not-found-home')}
              </Button>
            </div>
          </div>
        }
      />
    )
  },
})
