import { useCallback, useState } from 'react'
interface RetainedDialogState<T> {
  open: boolean
  payload: T | null
  openWith: (payload: T) => void
  close: () => void
}

export function useRetainedDialogState<T>(): RetainedDialogState<T> {
  const [open, setOpen] = useState(false)
  const [payload, setPayload] = useState<T | null>(null)

  const openWith = useCallback((nextPayload: T) => {
    setPayload(nextPayload)
    setOpen(true)
  }, [])

  const close = useCallback(() => {
    setOpen(false)
  }, [])

  return { open, payload, openWith, close }
}
