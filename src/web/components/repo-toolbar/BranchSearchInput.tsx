import { useLayoutEffect, useRef, useState, type FocusEvent } from 'react'
import { Search, X } from 'lucide-react'
import { Button } from '#/web/components/ui/button.tsx'
import { useT } from '#/web/stores/i18n.ts'
import { cn } from '#/web/lib/cn.ts'
import { Tip } from '#/web/components/Tip.tsx'
import { compositeFocusRing } from '#/web/components/ui/focus.ts'
interface Props {
  value: string
  disabled?: boolean
  onChange: (value: string) => void
}

export function BranchSearchInput({ value, disabled = false, onChange }: Props) {
  const t = useT()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [open, setOpen] = useState(false)
  const label = t('branches.search-label')
  const expanded = open || value.trim().length > 0

  useLayoutEffect(() => {
    if (!open) return
    inputRef.current?.focus({ preventScroll: true })
  }, [open])

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
    if (!value.trim()) setOpen(false)
  }

  function handleClear() {
    onChange('')
    setOpen(true)
    inputRef.current?.focus({ preventScroll: true })
  }

  return (
    <div
      onBlur={handleBlur}
      className={cn(
        'group/search relative flex h-7 shrink-0 items-center overflow-hidden rounded-md border border-input bg-control shadow-xs transition-[width,background-color,opacity] duration-150 ease-out',
        compositeFocusRing,
        expanded ? 'w-52' : 'w-7',
        !expanded && !disabled && 'hover:bg-control-hover',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <Search
        className={cn(
          'ml-1.5 size-3.5 shrink-0 text-muted-foreground',
          !disabled && 'group-hover/search:text-foreground',
        )}
        aria-hidden
      />
      <input
        ref={inputRef}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        autoCapitalize="none"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          if (value) {
            onChange('')
            return
          }
          setOpen(false)
          event.currentTarget.blur()
        }}
        aria-label={label}
        placeholder={t('branches.search-placeholder')}
        tabIndex={expanded ? 0 : -1}
        className={cn(
          'h-full min-w-0 flex-1 border-0 bg-transparent px-2 text-xs text-foreground outline-none transition-opacity duration-100 placeholder:text-muted-foreground/75 disabled:cursor-not-allowed',
          expanded ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />
      {!expanded && (
        <Tip label={label}>
          <Button
            type="button"
            variant="ghost"
            disabled={disabled}
            onClick={() => setOpen(true)}
            aria-label={label}
            className="absolute inset-0 h-auto w-auto rounded-md border-0 bg-transparent p-0 hover:bg-transparent focus-visible:outline-none disabled:cursor-not-allowed"
          />
        </Tip>
      )}
      {expanded && value && !disabled && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={handleClear}
          aria-label={t('branches.search-clear')}
          className="mr-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none [&_svg:not([class*='size-'])]:size-3"
        >
          <X />
        </Button>
      )}
    </div>
  )
}
