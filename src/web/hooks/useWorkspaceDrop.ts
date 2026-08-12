import { ref, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'
import { toast } from 'vue-sonner'
import { pathForDroppedFile } from '#/web/app-shell-client.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import { isShortcutBlockingLayerOpen } from '#/web/lib/layers.ts'
import { openWorkspacePaths } from '#/web/lib/open-workspace-paths.ts'
import {
  reportOpenWorkspacePostOpenError,
  reportOpenWorkspaceUncertainty,
} from '#/web/lib/open-workspace-result-feedback.ts'
import type { AppNavigationActions } from '#/web/app-navigation-actions.ts'

interface Options {
  /** True when an overlay (Settings/Help) is up. While blocked, the
   *  drop overlay stays hidden and drops are ignored — otherwise the
   *  dashed border would stack on top of the modal at the same
   *  z-index, and a drop would silently swap repos under a still-open
   *  Settings panel. */
  blocked: MaybeRefOrGetter<boolean>
  navigation: MaybeRefOrGetter<AppNavigationActions>
}

function hasFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes('Files') === true
}

function isDropBlocked(blocked: boolean): boolean {
  return blocked || isShortcutBlockingLayerOpen()
}

export function useWorkspaceDrop(options: Options) {
  const openWorkspaceMembership = workspacesStore.getState().openWorkspaceMembership
  const t = useT()
  const active = ref(false)

  // If a modal opens mid-drag, the gate stops reacting to enter/over/
  // drop but `setDropActive(false)` would never fire on its own. Force-clear
  // when blocked flips on so the dashed border doesn't stay painted
  // over the modal.
  watch(
    () => toValue(options.blocked),
    (isBlocked) => {
      if (isBlocked) active.value = false
    },
  )

  const onDragEnter = (event: DragEvent) => {
    if (!hasFiles(event)) return
    const handledByChild = event.defaultPrevented
    event.preventDefault()
    if (isDropBlocked(toValue(options.blocked))) return
    active.value = !handledByChild
  }

  const onDragOver = (event: DragEvent) => {
    if (!hasFiles(event)) return
    const handledByChild = event.defaultPrevented
    event.preventDefault()
    if (isDropBlocked(toValue(options.blocked))) return
    active.value = !handledByChild
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  }

  const onDragLeave = (event: DragEvent) => {
    if (!hasFiles(event)) return
    // Depth counters (enter++/leave--) are unreliable across child
    // boundaries — the dashed border ends up stuck "on" after a few
    // hovers. `relatedTarget === null` fires once when the cursor
    // exits the BrowserWindow, which is the signal we actually want.
    if (event.relatedTarget === null) active.value = false
  }

  const onDrop = (event: DragEvent) => {
    if (!hasFiles(event)) return
    const handledByChild = event.defaultPrevented
    event.preventDefault()
    active.value = false
    if (handledByChild) return
    if (isDropBlocked(toValue(options.blocked))) return
    const paths = Array.from(event.dataTransfer?.files ?? [])
      .map((file) => pathForDroppedFile(file))
      .filter((path) => path.length > 0)
    if (paths.length === 0) return
    void (async () => {
      await openWorkspacePaths(paths, {
        openWorkspaceMembership,
        activateWorkspace: (workspaceId) => toValue(options.navigation).activateWorkspace(workspaceId),
        onOpenFailed: (_path, result) => {
          if (!reportOpenWorkspaceUncertainty(result, t)) {
            toast.error(t('drop.open-failed'), { description: t(result.message) })
          }
        },
        onPostOpenError: (path, error) => {
          reportOpenWorkspacePostOpenError(error, t, { descriptionPrefix: path })
        },
      })
    })()
  }

  return { active, onDragEnter, onDragOver, onDragLeave, onDrop }
}
