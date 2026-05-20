import { type DragEvent, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useReposStore } from '#/renderer/stores/repos.ts'
import { useT } from '#/renderer/stores/i18n.ts'

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

export function useRepoDrop({ blocked }: Options) {
  const openRepo = useReposStore((s) => s.openRepo)
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
    event.preventDefault()
    if (blockedRef.current) return
    setActive(true)
  }

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(event)) return
    event.preventDefault()
    if (blockedRef.current) return
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
    event.preventDefault()
    setActive(false)
    if (blockedRef.current) return
    const paths = Array.from(event.dataTransfer.files)
      .map((file) => window.gbl.pathForFile(file))
      .filter((path) => path.length > 0)
    if (paths.length === 0) return
    void (async () => {
      // `activate: false` keeps openRepo from flipping activeId per
      // entry — without it, dropping five folders flashes through five
      // tabs before settling. Pin the first successful id at the end
      // so focus lands somewhere predictable. dataTransfer.files isn't
      // ordered by what the user clicked, so "first" just means
      // first-completed, not visually-first.
      let firstId: string | null = null
      for (const path of paths) {
        const result = await openRepo(path, { activate: false })
        if (!result.ok) {
          toast.error(tRef.current('drop.open-failed'), {
            description: tRef.current(result.message),
          })
          continue
        }
        firstId ??= result.id
      }
      if (firstId !== null) useReposStore.getState().setActive(firstId)
    })()
  }

  return { active, onDragEnter, onDragOver, onDragLeave, onDrop }
}
