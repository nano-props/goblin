import { computed, defineComponent, nextTick, onMounted, onScopeDispose, ref, watch } from 'vue'
import type { PropType } from 'vue'
import { CheckIcon, ChevronDownIcon, Loader2Icon } from '@lucide/vue'
import { Input } from '#/web/components/ui/input.tsx'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import type { ElementRef } from '#/web/components/ui/refs.ts'
import { composeRefs } from '#/web/components/ui/refs.ts'
import { cn } from '#/web/lib/cn.ts'

interface DirectoryPathSuggestionsProps {
  value: string
  onChange: (next: string) => void
  suggestions: readonly string[]
  isLoading?: boolean
  hasFetched?: boolean
  emptyLabel: string
  disabled?: boolean
  id?: string
  placeholder?: string
  autofocus?: boolean
  class?: string
  inputClass?: string
  onPopupOpenChange?: (open: boolean) => void
  inputRef?: ElementRef<HTMLInputElement>
  ariaInvalid?: boolean
  ariaDescribedby?: string
}

export const DirectoryPathSuggestions = defineComponent<DirectoryPathSuggestionsProps>({
  name: 'DirectoryPathSuggestions',
  props: {
    value: { type: String, required: true },
    onChange: { type: Function as PropType<(next: string) => void>, required: true },
    suggestions: { type: Array as PropType<readonly string[]>, required: true },
    isLoading: Boolean,
    hasFetched: Boolean,
    emptyLabel: { type: String, required: true },
    disabled: Boolean,
    id: String,
    placeholder: String,
    autofocus: Boolean,
    class: String,
    inputClass: String,
    onPopupOpenChange: Function as PropType<(open: boolean) => void>,
    inputRef: [Object, Function] as PropType<ElementRef<HTMLInputElement>>,
    ariaInvalid: Boolean,
    ariaDescribedby: String,
  },

  setup(props) {
    const innerRef = ref<HTMLInputElement | null>(null)
    const containerRef = ref<HTMLDivElement | null>(null)
    const open = ref(false)
    const activeIndex = ref(0)
    const optionRefs: Array<HTMLDivElement | null> = []
    let shouldScrollActiveIntoView = false

    const hasMatches = computed(() => props.suggestions.length > 0)
    const showEmptyState = computed(
      () =>
        !hasMatches.value &&
        props.value.trim().length > 0 &&
        (props.hasFetched ?? false) &&
        !(props.isLoading ?? false),
    )
    const showContent = computed(() => !(props.disabled ?? false) && (hasMatches.value || showEmptyState.value))
    const isOpen = computed(() => open.value && showContent.value)
    const listboxId = computed(() => `${props.id ?? 'directory-path'}-suggestions`)
    const activeOptionId = computed(() =>
      props.suggestions[activeIndex.value] === undefined ? undefined : `${listboxId.value}-option-${activeIndex.value}`,
    )

    // The server owns the suggestion projection. A replacement projection
    // invalidates the prior highlighted row and its element references.
    watch(
      () => props.suggestions,
      (suggestions) => {
        activeIndex.value = 0
        optionRefs.length = suggestions.length
      },
    )

    // The effective popup can also close when an async result changes, so the
    // parent notification must follow the derived state rather than input events.
    watch(
      isOpen,
      (value) => {
        props.onPopupOpenChange?.(value)
      },
      { immediate: true },
    )

    const closeOnOutsideInteraction = (event: Event) => {
      if (!isOpen.value) return
      const target = event.target
      if (target instanceof Node && containerRef.value?.contains(target)) return
      open.value = false
    }

    onMounted(() => {
      document.addEventListener('pointerdown', closeOnOutsideInteraction, true)
      document.addEventListener('focusin', closeOnOutsideInteraction)
    })
    onScopeDispose(() => {
      document.removeEventListener('pointerdown', closeOnOutsideInteraction, true)
      document.removeEventListener('focusin', closeOnOutsideInteraction)
      props.onPopupOpenChange?.(false)
    })

    const scrollActiveIntoView = () => {
      if (!shouldScrollActiveIntoView) return
      shouldScrollActiveIntoView = false
      optionRefs[activeIndex.value]?.scrollIntoView?.({ block: 'nearest' })
    }

    const selectActiveIndex = (index: number) => {
      shouldScrollActiveIntoView = true
      activeIndex.value = index
      void nextTick(scrollActiveIntoView)
    }

    const commit = (next: string) => {
      open.value = false
      props.onChange(next)
      innerRef.value?.focus()
    }

    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!isOpen.value) return
        event.preventDefault()
        event.stopPropagation()
        open.value = false
        return
      }
      if (props.disabled) return
      const suggestions = props.suggestions
      const wantsNavigation = event.key === 'ArrowDown' || event.key === 'ArrowUp'
      if (!open.value && wantsNavigation && suggestions.length > 0) open.value = true
      if (event.key === 'ArrowDown') {
        if (suggestions.length === 0) return
        event.preventDefault()
        selectActiveIndex((activeIndex.value + 1) % suggestions.length)
        return
      }
      if (event.key === 'ArrowUp') {
        if (suggestions.length === 0) return
        event.preventDefault()
        selectActiveIndex((activeIndex.value - 1 + suggestions.length) % suggestions.length)
        return
      }
      if (event.key === 'Home') {
        if (!open.value || suggestions.length === 0) return
        event.preventDefault()
        selectActiveIndex(0)
        return
      }
      if (event.key === 'End') {
        if (!open.value || suggestions.length === 0) return
        event.preventDefault()
        selectActiveIndex(suggestions.length - 1)
        return
      }
      if (event.key !== 'Enter' || !open.value || suggestions.length === 0) return
      event.preventDefault()
      const candidate = suggestions[activeIndex.value]
      if (candidate !== undefined) commit(candidate)
    }

    const setInputRef = composeRefs(innerRef, (element: HTMLInputElement | null) => {
      const target = props.inputRef
      if (!target) return
      if (typeof target === 'function') target(element)
      else target.value = element
    })

    return () => (
      <div ref={containerRef} class={cn('relative', props.class)}>
        <Input
          id={props.id}
          ref={(element) => {
            setInputRef(element instanceof HTMLInputElement ? element : null)
          }}
          value={props.value}
          onInput={(event) => {
            if (!(event.currentTarget instanceof HTMLInputElement)) return
            props.onChange(event.currentTarget.value)
            open.value = true
            activeIndex.value = 0
          }}
          onFocus={() => {
            if (showContent.value) open.value = true
          }}
          onKeydown={onKeydown}
          disabled={props.disabled}
          placeholder={props.placeholder}
          autofocus={props.autofocus}
          spellcheck={false}
          autocapitalize="off"
          autocorrect="off"
          aria-invalid={props.ariaInvalid}
          aria-describedby={props.ariaDescribedby}
          aria-autocomplete="list"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={isOpen.value}
          aria-controls={isOpen.value ? listboxId.value : undefined}
          aria-activedescendant={isOpen.value ? activeOptionId.value : undefined}
          class={cn('h-10 pr-8 font-mono text-sm', props.inputClass)}
        />
        {props.isLoading ? (
          <Loader2Icon
            aria-hidden="true"
            class="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
          />
        ) : (
          <ChevronDownIcon
            aria-hidden="true"
            class={cn(
              'pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground transition-transform',
              isOpen.value && 'rotate-180',
            )}
          />
        )}
        {isOpen.value ? (
          <div class="absolute top-[calc(100%+6px)] z-50 w-full min-w-0 overflow-hidden rounded-md border bg-popover p-0 text-popover-foreground shadow-md">
            <ScrollArea class="max-h-72" scrollbarMode="compact">
              <div id={listboxId.value} role="listbox" class="p-1">
                {showEmptyState.value ? (
                  <div role="status" class="px-2 py-1.5 text-sm text-muted-foreground">
                    <span class="truncate">{props.emptyLabel}</span>
                  </div>
                ) : (
                  props.suggestions.map((item, index) => {
                    const active = index === activeIndex.value
                    return (
                      <div
                        key={item}
                        ref={(element) => {
                          optionRefs[index] = element as HTMLDivElement | null
                        }}
                        role="option"
                        id={`${listboxId.value}-option-${index}`}
                        aria-selected={active}
                        onMousemove={() => {
                          if (!active) activeIndex.value = index
                        }}
                        onMousedown={(event) => {
                          event.preventDefault()
                          commit(item)
                        }}
                        class={cn(
                          'relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none',
                          active && 'bg-accent text-accent-foreground',
                        )}
                      >
                        <span class="flex-1 truncate font-mono text-sm">{item}</span>
                        <span class="absolute right-2 flex size-3.5 items-center justify-center">
                          {active ? <CheckIcon class="size-4 text-current" /> : null}
                        </span>
                      </div>
                    )
                  })
                )}
              </div>
            </ScrollArea>
          </div>
        ) : null}
      </div>
    )
  },
})
