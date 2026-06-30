import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

interface UseRepoScopedOverlayOptions {
  readonly activeRepoId: string | null
  readonly rawOpen: boolean
  readonly setRawOpen: (open: boolean) => void
}

interface RepoScopedOverlayState {
  readonly open: boolean
  readonly repoId: string | null
}

interface RepoScopedOverlay {
  readonly state: RepoScopedOverlayState
  readonly openForActiveRepo: () => void
  readonly setOpen: (open: boolean) => void
}

export function useRepoScopedOverlay({
  activeRepoId,
  rawOpen,
  setRawOpen,
}: UseRepoScopedOverlayOptions): RepoScopedOverlay {
  const [repoId, setRepoId] = useState<string | null>(null)
  const previousRawOpenRef = useRef(false)
  const rawOpenRising = rawOpen && !previousRawOpenRef.current
  const targetRepoId = rawOpenRising ? activeRepoId : (repoId ?? (rawOpen ? activeRepoId : null))

  const openForActiveRepo = useCallback(() => {
    if (!activeRepoId) return
    setRepoId(activeRepoId)
    setRawOpen(true)
  }, [activeRepoId, setRawOpen])

  const setOpen = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        if (!activeRepoId) return
        setRepoId(activeRepoId)
      }
      setRawOpen(nextOpen)
    },
    [activeRepoId, setRawOpen],
  )

  useEffect(() => {
    const wasRawOpen = previousRawOpenRef.current
    previousRawOpenRef.current = rawOpen
    if (!rawOpen) return
    if (!wasRawOpen) {
      if (activeRepoId === null) {
        setRawOpen(false)
        return
      }
      setRepoId(activeRepoId)
      return
    }
    if (repoId === null && activeRepoId !== null) {
      setRepoId(activeRepoId)
      return
    }
    if (targetRepoId !== null && activeRepoId === targetRepoId) return
    setRawOpen(false)
  }, [activeRepoId, rawOpen, repoId, setRawOpen, targetRepoId])

  const open = rawOpen && targetRepoId !== null && activeRepoId === targetRepoId
  const state = useMemo(() => ({ open, repoId: targetRepoId }), [open, targetRepoId])

  return { state, openForActiveRepo, setOpen }
}
