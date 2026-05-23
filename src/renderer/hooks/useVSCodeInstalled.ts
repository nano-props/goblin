import { useEffect, useState } from 'react'
import { rpc } from '#/renderer/rpc.ts'

export function useVSCodeInstalled() {
  const [vscodeInstalled, setVSCodeInstalled] = useState(false)

  useEffect(() => {
    let cancelled = false
    void rpc.repo.vscodeInstalled
      .query()
      .then((ok) => {
        if (!cancelled) setVSCodeInstalled(ok)
      })
      .catch((err) => {
        console.warn('[vscodeInstalled] failed', err)
        if (!cancelled) setVSCodeInstalled(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return vscodeInstalled
}
