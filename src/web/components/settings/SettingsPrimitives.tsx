import { defineComponent } from 'vue'
import type { Component, ComponentOptions, PropType, VNodeChild } from 'vue'
import type { LucideIcon } from '@lucide/vue'
import { SelectRoot } from 'reka-ui'
import { SelectContent, SelectItem, SelectTrigger } from '#/web/components/ui/select.tsx'
import { SelectValue } from '#/web/components/ui/SelectValue.tsx'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { cn } from '#/web/lib/cn.ts'

type SettingsElement = string | Exclude<Component, ComponentOptions>
type SettingsItemSize = 'sm' | 'md' | 'lg' | 'xl'
type SettingsSelectValue = string | number
type SettingsSelectOption = { value: SettingsSelectValue; label: string; icon?: LucideIcon }

export const SettingsGroup = defineComponent<{ label: VNodeChild; hint?: string; action?: VNodeChild }>({
  name: 'SettingsGroup',
  props: {
    label: { required: true },
    hint: String,
    action: null,
  },

  setup(props, { slots }) {
    const compact = useIsCompactUi()
    return () => (
      <section class="w-full space-y-1.5">
        <div class={cn('flex justify-between gap-3 px-3', compact.value ? 'items-start' : 'items-center')}>
          <h2 class="text-[11px] font-medium text-muted-foreground">{props.label}</h2>
          {props.action}
        </div>
        {props.hint ? <div class="px-3 text-[11px] leading-snug text-muted-foreground/80">{props.hint}</div> : null}
        {slots.default?.()}
      </section>
    )
  },
})

export const SettingsCard = defineComponent({
  name: 'SettingsCard',
  inheritAttrs: false,
  props: {
    as: [String, Object, Function] as PropType<SettingsElement>,
    class: null,
  },
  setup(props, { attrs, slots }) {
    return () => {
      const Element = props.as ?? 'div'
      return (
        <Element
          {...attrs}
          class={cn(
            'w-full overflow-hidden rounded-lg border border-border/60 bg-background/85 shadow-[var(--shadow-inset-highlight)]',
            props.class,
          )}
        >
          {slots.default?.()}
        </Element>
      )
    }
  },
})

export const SettingsList = defineComponent({
  name: 'SettingsList',
  setup(_props, { slots }) {
    return () => <SettingsCard>{slots.default?.()}</SettingsCard>
  },
})

export const SettingsListItem = defineComponent({
  name: 'SettingsListItem',
  inheritAttrs: false,
  props: {
    as: [String, Object, Function] as PropType<SettingsElement>,
    class: null,
    size: String as PropType<SettingsItemSize>,
    separated: { type: Boolean, default: true },
  },
  setup(props, { attrs, slots }) {
    return () => {
      const Element = props.as ?? 'div'
      const size = props.size ?? 'md'
      return (
        <Element
          {...attrs}
          class={cn(
            'flex min-w-0 items-center justify-between',
            props.separated && '[&+&]:border-t [&+&]:border-separator',
            size === 'sm' && 'min-h-9 gap-3 px-3 py-1.5',
            size === 'md' && 'min-h-11 gap-4 px-3 py-2',
            size === 'lg' && 'min-h-12 gap-4 px-4 py-2.5',
            size === 'xl' && 'min-h-14 gap-3 px-4 py-2.5',
            props.class,
          )}
        >
          {slots.default?.()}
        </Element>
      )
    }
  },
})

export const SettingsRow = defineComponent<{
  controlId: string
  label: VNodeChild
  hint?: string
  control: VNodeChild
}>({
  name: 'SettingsRow',
  props: {
    controlId: { type: String, required: true },
    label: { required: true },
    hint: String,
    control: { required: true },
  },

  setup(props) {
    const compact = useIsCompactUi()
    return () => (
      <SettingsListItem size="lg" class={cn(compact.value && 'flex-col items-stretch justify-start gap-2')}>
        <div class="min-w-0 flex-1 overflow-hidden">
          <label class="block truncate text-sm text-foreground" for={props.controlId}>
            {props.label}
          </label>
          {props.hint ? <div class="mt-0.5 text-[11px] leading-snug text-muted-foreground">{props.hint}</div> : null}
        </div>
        <div class={cn('min-w-0', compact.value ? 'w-full' : 'shrink-0')}>{props.control}</div>
      </SettingsListItem>
    )
  },
})

export const SettingsSelect = defineComponent<{
  id: string
  value: SettingsSelectValue
  options: SettingsSelectOption[]
  onChange: (value: SettingsSelectValue) => void
}>({
  name: 'SettingsSelect',
  props: {
    id: { type: String, required: true },
    value: { type: [String, Number] as PropType<SettingsSelectValue>, required: true },
    options: {
      type: Array as PropType<SettingsSelectOption[]>,
      required: true,
    },
    onChange: { type: Function as PropType<(value: SettingsSelectValue) => void>, required: true },
  },

  setup(props) {
    const compact = useIsCompactUi()
    return () => {
      const optionsSignature = props.options.map((option) => `${String(option.value)}:${option.label}`).join('|')
      const selectedOption = props.options.find((option) => String(option.value) === String(props.value))
      const SelectedIcon = selectedOption?.icon
      return (
        <SelectRoot
          key={optionsSignature}
          modelValue={String(props.value)}
          onUpdate:modelValue={(value) => {
            const matched = props.options.find((option) => String(option.value) === value)
            if (matched) props.onChange(matched.value)
          }}
        >
          <SelectTrigger
            id={props.id}
            class={cn(
              'h-8 rounded-md bg-control px-2.5 text-xs shadow-none',
              compact.value ? 'w-full min-w-0' : 'min-w-36',
            )}
          >
            <SelectValue>
              {SelectedIcon ? <SelectedIcon class="size-4" /> : null}
              {selectedOption?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {props.options.map((option) => {
              const Icon = option.icon
              return (
                <SelectItem key={String(option.value)} value={String(option.value)} textValue={option.label}>
                  {Icon ? <Icon class="size-4" /> : null}
                  {option.label}
                </SelectItem>
              )
            })}
          </SelectContent>
        </SelectRoot>
      )
    }
  },
})
