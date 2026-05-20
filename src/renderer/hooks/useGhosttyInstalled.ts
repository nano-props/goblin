import { useEffect, useState } from 'react'

export function useGhosttyInstalled() {
  const [ghosttyInstalled, setGhosttyInstalled] = useState(false)

  useEffect(() => {
    let cancelled = false
    void window.gbl
      .ghosttyInstalled()
      .then((ok) => {
        if (!cancelled) setGhosttyInstalled(ok)
      })
      .catch((err) => {
        console.warn('[ghosttyInstalled] failed', err)
        if (!cancelled) setGhosttyInstalled(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return ghosttyInstalled
}
