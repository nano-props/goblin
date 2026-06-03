import { type DragEvent, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { pathForDroppedFile } from '#/web/app-shell-client.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useT } from '#/web/stores/i18n.ts'
import { isShortcutBlockingLayerOpen } from '#/web/lib/layers.ts'
import { openRepoPaths } from '#/web/lib/open-repo-paths.ts'
import { useMainWindowNavigation } from '#/web/main-window-navigation.tsx'
interface Options {
  /** True when an overlay (Settings/Help) is up. While blocked, the
   *  drop overlay stays hidden and drops are ignored — otherwise the
   *  dashed border would stack on top of the modal at the same
   *  z-index, and a drop would silently swap repos under a still-open
   *  Settings panel. */
  blocked: boolean
}

function hasFiles(event: DragEvent<HTMLDivElement>): boolean {
  return event.dataTransfer.types.includes('Files')
}

function isDropBlocked(blocked: boolean): boolean {
  return blocked || isShortcutBlockingLayerOpen()
}

export function useRepoDrop({ blocked }: Options) {
  const ensureWorkspaceOpen = useReposStore((s) => s.ensureWorkspaceOpen)
  const navigation = useMainWindowNavigation()
  const t = useT()
  const tRef = useRef(t)
  tRef.current = t
  const blockedRef = useRef(blocked)
  blockedRef.current = blocked
  const [active, setActive] = useState(false)

  // If a modal opens mid-drag, the gate stops reacting to enter/over/
  // drop but `setActive(false)` would never fire on its own. Force-clear
  // when blocked flips on so the dashed border doesn't stay painted
  // over the modal.
  useEffect(() => {
    if (blocked) setActive(false)
  }, [blocked])

  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(event)) return
    const handledByChild = event.isDefaultPrevented()
    event.preventDefault()
    if (isDropBlocked(blockedRef.current)) return
    setActive(!handledByChild)
  }

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(event)) return
    const handledByChild = event.isDefaultPrevented()
    event.preventDefault()
    if (isDropBlocked(blockedRef.current)) return
    setActive(!handledByChild)
    event.dataTransfer.dropEffect = 'copy'
  }

  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(event)) return
    // Depth counters (enter++/leave--) are unreliable across child
    // boundaries — the dashed border ends up stuck "on" after a few
    // hovers. `relatedTarget === null` fires once when the cursor
    // exits the BrowserWindow, which is the signal we actually want.
    if (event.relatedTarget === null) setActive(false)
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(event)) return
    const handledByChild = event.isDefaultPrevented()
    event.preventDefault()
    setActive(false)
    if (handledByChild) return
    if (isDropBlocked(blockedRef.current)) return
    const paths = Array.from(event.dataTransfer.files)
      .map((file) => pathForDroppedFile(file))
      .filter((path) => path.length > 0)
    if (paths.length === 0) return
    void (async () => {
      await openRepoPaths(paths, {
        ensureWorkspaceOpen,
        activateRepo: navigation.activateRepo,
        onOpenFailed: (_path, message) => {
          toast.error(tRef.current('drop.open-failed'), {
            description: tRef.current(message),
          })
        },
      })
    })()
  }

  return { active, onDragEnter, onDragOver, onDragLeave, onDrop }
}
