// Typeable path input with a styled suggestion dropdown. Replaces the
// HTML5 <datalist> autocomplete used by OpenRemoteRepositoryDialog and
// CreateWorktreeDialog — <datalist> renders with browser-native chrome
// that ignores our design tokens and varies across Electron versions.
//
// Visual + interaction parity with the Select dropdown used by
// CreateWorktreeDialog's branch pickers:
//   • floating surface shares the SelectContent chrome (border, shadow,
//     padding, slide/fade animations)
//   • one labelled "Suggestions" group with SelectItem-style rows
//   • keyboard nav: ↓/↑ move the highlight, Home/End jump to ends,
//     Enter commits, Esc/click-out dismisses (Esc handled by Radix
//     DismissableLayer on document), focus re-opens
//   • the highlighted option is scrolled into view (block: nearest) so
//     it stays visible while the user pages through long lists
//
// The parent owns `value` / `onChange`. No client-side filter is
// applied — the server's `getServerRemotePathSuggestions` already
// constrains results to entries under the typed prefix, and a second
// filter on top would drop legitimate siblings as soon as the user
// commits one and continues typing from the committed path.

import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MutableRefObject, Ref } from 'react'
import { ChevronDownIcon, CornerDownLeftIcon } from 'lucide-react'
import { Popover, PopoverAnchor, PopoverContent } from '#/web/components/ui/popover.tsx'
import { Input } from '#/web/components/ui/input.tsx'
import { cn } from '#/web/lib/cn.ts'

interface RemotePathSuggestionsProps {
  /** Controlled input value. */
  value: string
  onChange: (next: string) => void
  /** Suggestion strings to render in the dropdown. */
  suggestions: readonly string[]
  /** i18n label rendered as the section heading. */
  groupLabel: string
  /** i18n label for the empty state when `suggestions` is empty but the
   *  dropdown is shown (e.g. the user typed something with no matches). */
  emptyLabel: string
  /** Disable the input + dropdown (e.g. while a connection test runs). */
  disabled?: boolean
  /** ARIA / passthrough. */
  id?: string
  placeholder?: string
  className?: string
  /** Forwarded onto the underlying <input>; mirror the same `aria-invalid`
   *  you would put on Input so the error styling still applies. */
  'aria-invalid'?: boolean
  'aria-describedby'?: string
}

export const RemotePathSuggestions = forwardRef<HTMLInputElement, RemotePathSuggestionsProps>(
  function RemotePathSuggestions(
    {
      value,
      onChange,
      suggestions,
      groupLabel,
      emptyLabel,
      disabled,
      id,
      placeholder,
      className,
      'aria-invalid': ariaInvalid,
      'aria-describedby': ariaDescribedBy,
    },
    forwardedRef,
  ) {
    const innerRef = useRef<HTMLInputElement | null>(null)
    // Combine our internal ref (used by `commit` and `onChange`) with
    // the parent's forwarded ref. `useImperativeHandle` with a `null`
    // initial value would TypeScript-lie about the ref type; using a
    // callback ref sidesteps that and keeps both refs in sync. The
    // parent may pass either a callback ref or a ref object.
    const setInputRef = useCallback(
      (node: HTMLInputElement | null) => {
        innerRef.current = node
        if (!forwardedRef) return
        if (typeof forwardedRef === 'function') forwardedRef(node)
        else (forwardedRef as MutableRefObject<HTMLInputElement | null>).current = node
      },
      [forwardedRef],
    )
    const [open, setOpen] = useState(false)
    const [activeIndex, setActiveIndex] = useState(0)
    const optionRefs = useRef<(HTMLDivElement | null)[]>([])

    // Clamp the highlight when the list shrinks. Only depends on the
    // list shape — re-running on every `activeIndex` change is wasted
    // work and would create a setState loop on every keystroke.
    useEffect(() => {
      setActiveIndex((idx) => (idx >= suggestions.length ? 0 : idx))
    }, [suggestions.length])

    // Keep the highlighted row in view as the user pages through long
    // lists. `useLayoutEffect` runs before paint so the highlight never
    // flashes off-screen. `block: 'nearest'` avoids unnecessary scroll
    // when the row is already visible.
    useLayoutEffect(() => {
      const activeEl = optionRefs.current[activeIndex]
      if (activeEl && typeof activeEl.scrollIntoView === 'function') {
        activeEl.scrollIntoView({ block: 'nearest' })
      }
    }, [activeIndex])

    // Whether the popover is visible. The popover surfaces two states
    // inside: the suggestion list, or a "no matches" row (the latter
    // only once the user has typed something — we don't want to flash
    // "no matches" before the first server response has landed, since
    // an empty `suggestions` initially just means "haven't queried
    // yet").
    const hasMatches = suggestions.length > 0
    const hasTypedQuery = value.trim().length > 0
    const showEmptyState = !hasMatches && hasTypedQuery
    const showContent = !disabled && (hasMatches || showEmptyState)
    const isOpen = open && showContent

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
          setActiveIndex((idx) => (idx + 1) % suggestions.length)
          return
        }
        if (event.key === 'ArrowUp') {
          if (suggestions.length === 0) return
          event.preventDefault()
          setActiveIndex((idx) => (idx - 1 + suggestions.length) % suggestions.length)
          return
        }
        if (event.key === 'Home') {
          if (suggestions.length === 0) return
          event.preventDefault()
          setActiveIndex(0)
          return
        }
        if (event.key === 'End') {
          if (suggestions.length === 0) return
          event.preventDefault()
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
        // Escape is handled by Radix DismissableLayer (document-level
        // listener) — nothing for us to do here.
      },
      [activeIndex, commit, disabled, open],
    )

    const setOptionRef = useCallback(
      (index: number) => (node: HTMLDivElement | null) => {
        optionRefs.current[index] = node
      },
      [],
    )

    return (
      <Popover open={isOpen} onOpenChange={setOpen} modal={false}>
        <PopoverAnchor asChild>
          <div className="relative">
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
                if (!disabled && suggestions.length > 0) setOpen(true)
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
            <ChevronDownIcon
              aria-hidden
              className={cn(
                'pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground transition-transform',
                isOpen && 'rotate-180',
              )}
            />
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          sideOffset={6}
          collisionPadding={8}
          onOpenAutoFocus={(event) => event.preventDefault()}
          className="w-[var(--radix-popover-trigger-width)] min-w-0 p-0"
        >
          <div id={listboxId} role="listbox" className="max-h-72 overflow-auto p-1">
            <SuggestionGroup label={groupLabel}>
              {showEmptyState ? (
                <SuggestionRow active={false}>
                  <span className="truncate text-muted-foreground">{emptyLabel}</span>
                </SuggestionRow>
              ) : (
                suggestions.map((item, index) => (
                  <SuggestionRow
                    // Server-side `getServerRemotePathSuggestions` does
                    // not dedupe; prefix the index so a pathological
                    // duplicate pair doesn't trip React's key warning.
                    key={`${index}-${item}`}
                    id={`${listboxId}-option-${index}`}
                    active={index === activeIndex}
                    hint={
                      index === activeIndex ? (
                        <CornerDownLeftIcon aria-hidden className="size-3.5 text-muted-foreground" />
                      ) : null
                    }
                    rowRef={setOptionRef(index)}
                    onMouseEnter={() => setActiveIndex(index)}
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
            </SuggestionGroup>
          </div>
        </PopoverContent>
      </Popover>
    )
  },
)

function SuggestionGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-0.5">
      <div className="px-2 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  )
}

function SuggestionRow({
  active,
  hint,
  id,
  rowRef,
  onMouseDown,
  onMouseEnter,
  children,
}: {
  active: boolean
  hint?: React.ReactNode
  id?: string
  rowRef?: (node: HTMLDivElement | null) => void
  onMouseDown?: React.MouseEventHandler<HTMLDivElement>
  onMouseEnter?: React.MouseEventHandler<HTMLDivElement>
  children: React.ReactNode
}) {
  return (
    <div
      ref={rowRef}
      role="option"
      id={id}
      aria-selected={active}
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      className={cn(
        'flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none',
        active && 'bg-accent text-accent-foreground',
      )}
    >
      <span className="flex-1 truncate">{children}</span>
      {hint ? <span className="flex shrink-0 items-center">{hint}</span> : null}
    </div>
  )
}
