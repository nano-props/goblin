// Typeable path input with a styled suggestion dropdown. Replaces the
// HTML5 <datalist> autocomplete used by OpenRemoteRepositoryDialog and
// CreateWorktreeDialog — <datalist> renders with browser-native chrome
// that ignores our design tokens and varies across Electron versions.
//
// Visual + interaction parity with the Select dropdown used by
// CreateWorktreeDialog's branch pickers:
//   • floating surface shares the same border, shadow, and p-1 inner
//     padding rhythm
//   • rows use the SelectItem layout verbatim: pr-8 / pl-2, rounded-sm,
//     accent fill on the active row, ✓ CheckIcon on the right rail
//   • keyboard nav: ↓/↑ move the highlight, Home/End jump to ends,
//     Enter commits, Esc/click-out dismisses, focus re-opens
//   • the highlighted option is scrolled into view (block: nearest) so
//     it stays visible while the user pages through long lists
//
// The parent owns `value` / `onChange`. No client-side filter is
// applied — the server's `getServerRemotePathSuggestions` already
// constrains results to entries under the typed prefix, and a second
// filter on top would drop legitimate siblings as soon as the user
// commits one and continues typing from the committed path.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, Ref } from 'react'
import { CheckIcon, ChevronDownIcon, Loader2Icon } from 'lucide-react'
import { Input } from '#/web/components/ui/input.tsx'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { cn } from '#/web/lib/cn.ts'
import { composeRefs } from '#/web/components/ui/refs.ts'

interface RemotePathSuggestionsProps {
  /** Controlled input value. */
  value: string
  onChange: (next: string) => void
  /** Suggestion strings to render in the dropdown. */
  suggestions: readonly string[]
  /** Whether a suggestions request is currently in flight. */
  isLoading?: boolean
  /** Whether at least one suggestions request has completed. */
  hasFetched?: boolean
  /** i18n label for the empty state when `suggestions` is empty but the
   *  dropdown is shown (e.g. the user typed something with no matches). */
  emptyLabel: string
  /** Disable the input + dropdown (e.g. while a connection test runs). */
  disabled?: boolean
  /** ARIA / passthrough. */
  id?: string
  placeholder?: string
  className?: string
  ref?: Ref<HTMLInputElement>
  /** Forwarded onto the underlying <input>; mirror the same `aria-invalid`
   *  you would put on Input so the error styling still applies. */
  'aria-invalid'?: boolean
  'aria-describedby'?: string
}

export function RemotePathSuggestions({
  value,
  onChange,
  suggestions,
  isLoading = false,
  hasFetched = false,
  emptyLabel,
  disabled,
  id,
  placeholder,
  className,
  ref,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: RemotePathSuggestionsProps) {
  const innerRef = useRef<HTMLInputElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const setInnerRef = useCallback((node: HTMLInputElement | null) => {
    innerRef.current = node
  }, [])
  const setInputRef = useMemo(() => composeRefs(setInnerRef, ref), [ref, setInnerRef])
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const optionRefs = useRef<(HTMLDivElement | null)[]>([])
  const shouldScrollActiveIntoViewRef = useRef(false)

  // Clamp the highlight when the list shrinks, and drop refs to
  // options that have fallen off the end so the array doesn't carry
  // stale entries. Only depends on the list shape — re-running on
  // every `activeIndex` change is wasted work and would create a
  // setState loop on every keystroke.
  useEffect(() => {
    setActiveIndex((idx) => (idx >= suggestions.length ? 0 : idx))
    optionRefs.current.length = suggestions.length
  }, [suggestions.length])

  // Keep the highlighted row in view as the user pages through long
  // lists. `useLayoutEffect` runs before paint so the highlight never
  // flashes off-screen. `block: 'nearest'` avoids unnecessary scroll
  // when the row is already visible.
  useLayoutEffect(() => {
    if (!shouldScrollActiveIntoViewRef.current) return
    shouldScrollActiveIntoViewRef.current = false
    const activeEl = optionRefs.current[activeIndex]
    if (activeEl && typeof activeEl.scrollIntoView === 'function') {
      activeEl.scrollIntoView({ block: 'nearest' })
    }
  }, [activeIndex])

  // Whether the popover is visible. The popover surfaces two states
  // inside: the suggestion list, or a "no matches" row (the latter
  // only once the user has typed something and a server response has
  // landed — an empty `suggestions` before the first response just
  // means "haven't queried yet". During loading we keep showing the
  // prior list, if any, and otherwise keep the popup closed.
  const hasMatches = suggestions.length > 0
  const hasTypedQuery = value.trim().length > 0
  const showEmptyState = !hasMatches && hasTypedQuery && hasFetched && !isLoading
  const showContent = !disabled && (hasMatches || showEmptyState)
  const isOpen = open && showContent

  useEffect(() => {
    if (!isOpen) return
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null
      if (target && containerRef.current?.contains(target)) return
      setOpen(false)
    }
    function onFocusIn(event: FocusEvent) {
      const target = event.target as Node | null
      if (target && containerRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('focusin', onFocusIn)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('focusin', onFocusIn)
    }
  }, [isOpen])

  // Stable ids for the listbox and its options. The listbox id is
  // hoisted into a const so the input's `aria-controls` /
  // `aria-activedescendant` and the listbox element stay in sync.
  const listboxId = `${id ?? 'remote-path'}-suggestions`
  const activeOptionId = hasMatches ? `${listboxId}-option-${activeIndex}` : undefined

  const commit = useCallback(
    (next: string) => {
      onChange(next)
      // Keep focus on the input so the user can keep typing/editing.
      innerRef.current?.focus()
    },
    [onChange],
  )

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape') {
        setOpen(false)
        return
      }
      if (disabled) return
      const wantsNav =
        event.key === 'ArrowDown' ||
        event.key === 'ArrowUp' ||
        event.key === 'Home' ||
        event.key === 'End' ||
        event.key === 'Enter'
      // Re-open the dropdown on navigation keys when the user has
      // dismissed it — keeps the workflow fluid.
      if (!open && wantsNav && suggestions.length > 0) {
        setOpen(true)
      }
      if (event.key === 'ArrowDown') {
        if (suggestions.length === 0) return
        event.preventDefault()
        shouldScrollActiveIntoViewRef.current = true
        setActiveIndex((idx) => (idx + 1) % suggestions.length)
        return
      }
      if (event.key === 'ArrowUp') {
        if (suggestions.length === 0) return
        event.preventDefault()
        shouldScrollActiveIntoViewRef.current = true
        setActiveIndex((idx) => (idx - 1 + suggestions.length) % suggestions.length)
        return
      }
      if (event.key === 'Home') {
        if (suggestions.length === 0) return
        event.preventDefault()
        shouldScrollActiveIntoViewRef.current = true
        setActiveIndex(0)
        return
      }
      if (event.key === 'End') {
        if (suggestions.length === 0) return
        event.preventDefault()
        shouldScrollActiveIntoViewRef.current = true
        setActiveIndex(suggestions.length - 1)
        return
      }
      if (event.key === 'Enter') {
        if (suggestions.length === 0) return
        event.preventDefault()
        const candidate = suggestions[activeIndex]
        if (candidate !== undefined) commit(candidate)
        return
      }
    },
    [activeIndex, commit, disabled, open, suggestions],
  )

  const setOptionRef = useCallback((index: number, node: HTMLDivElement | null) => {
    optionRefs.current[index] = node
  }, [])

  return (
    <div ref={containerRef} className="relative">
      <Input
        id={id}
        ref={setInputRef}
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
          setOpen(true)
          setActiveIndex(0)
        }}
        onFocus={() => {
          if (showContent) setOpen(true)
        }}
        onKeyDown={onKeyDown}
        disabled={disabled}
        placeholder={placeholder}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        // WAI-ARIA combobox pattern: focus stays on the input,
        // `aria-activedescendant` points at the currently
        // highlighted option so screen readers announce the move
        // as the user presses ↑/↓. Only set when the popup is
        // open and there's a real option to point at.
        aria-activedescendant={isOpen && activeOptionId ? activeOptionId : undefined}
        className={cn('h-10 pr-8 font-mono text-sm', className)}
      />
      {isLoading ? (
        <Loader2Icon
          aria-hidden
          className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
        />
      ) : (
        <ChevronDownIcon
          aria-hidden
          className={cn(
            'pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground transition-transform',
            isOpen && 'rotate-180',
          )}
        />
      )}
      {isOpen ? (
        <div className="bg-popover text-popover-foreground absolute top-[calc(100%+6px)] z-50 w-full min-w-0 overflow-hidden rounded-md border p-0 shadow-md">
          <ScrollArea className="max-h-72" scrollbarMode="compact">
            <div id={listboxId} role="listbox" className="p-1">
              {showEmptyState ? (
                <SuggestionRow active={false}>
                  <span className="truncate text-muted-foreground">{emptyLabel}</span>
                </SuggestionRow>
              ) : (
                suggestions.map((item, index) => (
                  <SuggestionRow
                    // Suggestions are deduped in useRemotePathSuggestions,
                    // so the path itself is a stable key.
                    key={item}
                    id={`${listboxId}-option-${index}`}
                    active={index === activeIndex}
                    rowRef={(node) => setOptionRef(index, node)}
                    onMouseMove={() => {
                      if (index === activeIndex) return
                      setActiveIndex(index)
                    }}
                    onMouseDown={(event) => {
                      // mousedown so the input keeps focus and the click
                      // doesn't first blur the input and lose state.
                      event.preventDefault()
                      commit(item)
                    }}
                  >
                    <span className="truncate font-mono text-sm">{item}</span>
                  </SuggestionRow>
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      ) : null}
    </div>
  )
}

// Row chrome mirrors SelectItem verbatim — pr-8 / pl-2, rounded-sm,
// accent fill on the active row, and an absolutely-positioned ✓
// CheckIcon on the right rail. Keeping the layout identical to
// SelectItem is what makes the dropdown read as the same UI family as
// the branch picker.
function SuggestionRow({
  active,
  id,
  rowRef,
  onMouseDown,
  onMouseMove,
  children,
}: {
  active: boolean
  id?: string
  rowRef?: (node: HTMLDivElement | null) => void
  onMouseDown?: React.MouseEventHandler<HTMLDivElement>
  onMouseMove?: React.MouseEventHandler<HTMLDivElement>
  children: ReactNode
}) {
  return (
    <div
      ref={rowRef}
      role="option"
      id={id}
      aria-selected={active}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      className={cn(
        'relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none',
        active && 'bg-accent text-accent-foreground',
      )}
    >
      <span className="flex-1 truncate">{children}</span>
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        {active ? <CheckIcon className="size-4 text-current" /> : null}
      </span>
    </div>
  )
}
