import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useT } from '#/web/stores/i18n.ts'
import { onNativeEventType } from '#/web/native-bridge.ts'
export function useSettingsWriteErrorToast() {
  const t = useT()
  // `t` is read through a ref so a language switch doesn't tear down /
  // re-subscribe the IPC listener — the dict update only matters for
  // toasts fired *after* the switch, which the ref read handles.
  // Synced in render body (not via useEffect) so the ref is current the
  // moment a new `t` is computed; an effect-based sync would leave the
  // ref one render stale, and a toast fired in that window would render
  // with the previous language.
  const tRef = useRef(t)
  tRef.current = t

  useEffect(() => {
    const off = onNativeEventType('settings-write-error', (event) => {
      toast.error(tRef.current('error.settings-write-title'), { description: event.message })
    })
    return off
  }, [])
}
