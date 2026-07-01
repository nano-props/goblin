import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'

interface FloatingSurfaceBoundaryContextValue {
  registerOpenSurface: () => () => void
}

interface FloatingSurfaceBoundaryProps {
  children: ReactNode
  onPinnedChange?: (pinned: boolean) => void
}

const FloatingSurfaceBoundaryContext = createContext<FloatingSurfaceBoundaryContextValue | null>(null)

export function FloatingSurfaceBoundary({ children, onPinnedChange }: FloatingSurfaceBoundaryProps) {
  const [openDescendantCount, setOpenDescendantCount] = useState(0)
  const pinned = openDescendantCount > 0
  const registerOpenSurface = useCallback(() => {
    let registered = true
    setOpenDescendantCount((count) => count + 1)

    return () => {
      if (!registered) return
      registered = false
      setOpenDescendantCount((count) => Math.max(0, count - 1))
    }
  }, [])
  const value = useMemo<FloatingSurfaceBoundaryContextValue>(() => ({ registerOpenSurface }), [registerOpenSurface])

  useLayoutEffect(() => {
    onPinnedChange?.(pinned)
  }, [onPinnedChange, pinned])

  return <FloatingSurfaceBoundaryContext value={value}>{children}</FloatingSurfaceBoundaryContext>
}

export function useFloatingSurfaceBoundaryPin(open: boolean) {
  const boundary = useContext(FloatingSurfaceBoundaryContext)

  useLayoutEffect(() => {
    if (!open || !boundary) return
    return boundary.registerOpenSurface()
  }, [boundary, open])
}
