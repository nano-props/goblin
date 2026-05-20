import { useEffect, useState } from 'react'

export function useVSCodeInstalled() {
  const [vscodeInstalled, setVSCodeInstalled] = useState(false)

  useEffect(() => {
    let cancelled = false
    void window.gbl
      .vscodeInstalled()
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
