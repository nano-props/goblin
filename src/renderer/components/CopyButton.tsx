import { Check, Copy } from 'lucide-react'
import { useEffect, useRef, useState, type ComponentPropsWithoutRef } from 'react'
import { toast } from 'sonner'
import { useT } from '#/renderer/stores/i18n.ts'
import { Tip } from '#/renderer/components/Tip.tsx'
import { Button } from '#/renderer/components/ui/button.tsx'
import { cn } from '#/renderer/lib/cn.ts'

const COPY_FEEDBACK_MS = 3000

type CopyButtonProps = Omit<
  ComponentPropsWithoutRef<typeof Button>,
  'aria-label' | 'asChild' | 'children' | 'onClick' | 'size' | 'title' | 'type' | 'variant'
> & {
  value: string
  copyLabel: string
  copiedLabel: string
}

export function CopyButton({ value, copyLabel, copiedLabel, className, disabled, ...props }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)
  const [copying, setCopying] = useState(false)
  const t = useT()
  const copiedTimerRef = useRef<number | null>(null)

  function clearCopiedTimer() {
    if (copiedTimerRef.current) {
      window.clearTimeout(copiedTimerRef.current)
      copiedTimerRef.current = null
    }
  }

  useEffect(() => {
    setCopied(false)
    setCopying(false)
    clearCopiedTimer()
  }, [value])

  useEffect(() => {
    return clearCopiedTimer
  }, [])

  function copy() {
    if (copying) return
    setCopying(true)
    void navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true)
        clearCopiedTimer()
        copiedTimerRef.current = window.setTimeout(() => {
          setCopied(false)
          copiedTimerRef.current = null
        }, COPY_FEEDBACK_MS)
      })
      .catch((err: unknown) => {
        setCopied(false)
        clearCopiedTimer()
        toast.error(t('action.result-error'), {
          description: err instanceof Error ? err.message : String(err),
        })
      })
      .finally(() => {
        setCopying(false)
      })
  }

  return (
    <Tip label={copied ? copiedLabel : copyLabel} side="right" forceOpen={copied}>
      <Button
        {...props}
        type="button"
        variant="ghost"
        size="icon"
        className={cn('size-6 text-muted-foreground hover:text-foreground', className)}
        aria-label={copied ? copiedLabel : copyLabel}
        aria-busy={copying ? true : undefined}
        disabled={disabled || copying}
        onClick={copy}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </Button>
    </Tip>
  )
}
