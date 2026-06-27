import { useEffect, useRef, useState, type ComponentPropsWithoutRef } from 'react'
import { toast } from 'sonner'
import { useT } from '#/web/stores/i18n.ts'
import { IconCopyButton } from '#/web/components/IconCopyButton.tsx'
import { useActionFeedback } from '#/web/hooks/useActionFeedback.ts'

type CopyButtonProps = Omit<
  ComponentPropsWithoutRef<typeof IconCopyButton>,
  'busy' | 'label' | 'onClick' | 'succeeded'
> & {
  value: string
  copyLabel: string
  copiedLabel: string
}

export function CopyButton({ value, copyLabel, copiedLabel, className, disabled, ...props }: CopyButtonProps) {
  // `copying` guards against double-clicks while the clipboard write is
  // in flight; `succeeded` is the post-success flash managed by the
  // shared hook. When `value` changes mid-flight, drop the flash so an
  // old "Copied!" tooltip can't bleed across rows.
  const { succeeded, trigger, reset } = useActionFeedback()
  const [copying, setCopying] = useState(false)
  const requestIdRef = useRef(0)
  const valueRef = useRef(value)
  const t = useT()

  if (valueRef.current !== value) {
    valueRef.current = value
    requestIdRef.current += 1
  }

  useEffect(() => {
    reset()
    setCopying(false)
  }, [value, reset])

  function copy() {
    if (copying) return
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    const copiedValue = value
    setCopying(true)
    void navigator.clipboard
      .writeText(copiedValue)
      .then(() => {
        if (requestIdRef.current !== requestId || valueRef.current !== copiedValue) return
        trigger(() => true)
      })
      .catch((err: unknown) => {
        if (requestIdRef.current !== requestId || valueRef.current !== copiedValue) return
        toast.error(t('action.result-error'), {
          description: err instanceof Error ? err.message : String(err),
        })
      })
      .finally(() => {
        if (requestIdRef.current === requestId) setCopying(false)
      })
  }

  return (
    <IconCopyButton
      {...props}
      className={className}
      label={succeeded ? copiedLabel : copyLabel}
      succeeded={succeeded}
      busy={copying}
      disabled={disabled || copying}
      onClick={copy}
    />
  )
}
