import { useEffect, useState } from 'react'
import { rpc } from '#/renderer/rpc.ts'

export function useGhosttyInstalled() {
  const [ghosttyInstalled, setGhosttyInstalled] = useState(false)

  useEffect(() => {
    let cancelled = false
    void rpc.repo.ghosttyInstalled
      .query()
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
