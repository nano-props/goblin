import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from '@lucide/vue'
import {
  SelectContent as RekaSelectContent,
  SelectIcon,
  SelectItem as RekaSelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectPortal,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectTrigger as RekaSelectTrigger,
  SelectViewport,
} from 'reka-ui'
import type { AcceptableValue, SelectItemProps as RekaSelectItemProps } from 'reka-ui'
import type { ButtonHTMLAttributes, FunctionalComponent, HTMLAttributes } from 'vue'
import { cn } from '#/web/lib/cn.ts'
import { focusRingVisibleInset } from '#/web/components/ui/focus.ts'

type SelectTriggerProps = Omit<InstanceType<typeof RekaSelectTrigger>['$props'], 'class' | 'size'> &
  ButtonHTMLAttributes & {
    size?: 'sm' | 'default'
  }

export const SelectTrigger: FunctionalComponent<SelectTriggerProps> = (props, { slots }) => {
  const { class: classValue, size = 'default', ...triggerProps } = props
  return (
    <RekaSelectTrigger
      {...triggerProps}
      data-slot="select-trigger"
      data-size={size}
      class={cn(
        "border-input bg-control data-[placeholder]:text-muted-foreground hover:bg-control-hover [&_svg:not([class*='text-'])]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-danger/20 dark:aria-invalid:ring-danger/40 aria-invalid:border-danger-border flex w-fit cursor-pointer items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow,background-color] outline-none disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        focusRingVisibleInset,
        classValue,
      )}
    >
      {slots.default?.()}
      <SelectIcon asChild>
        <ChevronDownIcon class="size-4 opacity-50" />
      </SelectIcon>
    </RekaSelectTrigger>
  )
}
SelectTrigger.inheritAttrs = false

type SelectContentProps = Omit<InstanceType<typeof RekaSelectContent>['$props'], 'class'> & {
  class?: HTMLAttributes['class']
}

export const SelectContent: FunctionalComponent<SelectContentProps> = (props, { slots }) => {
  const { class: classValue, position = 'popper', ...contentProps } = props
  return (
    <SelectPortal>
      <RekaSelectContent
        {...contentProps}
        data-slot="select-content"
        class={cn(
          'relative z-50 max-h-(--reka-select-content-available-height) min-w-[8rem] origin-(--reka-select-content-transform-origin) overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
          position === 'popper' &&
            'data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1',
          classValue,
        )}
        position={position}
      >
        <SelectScrollUpButton class="flex cursor-default items-center justify-center py-1">
          <ChevronUpIcon class="size-4" />
        </SelectScrollUpButton>
        <SelectViewport
          class={cn(
            'p-1',
            position === 'popper' &&
              'h-[var(--reka-select-trigger-height)] w-full min-w-[var(--reka-select-trigger-width)] scroll-my-1',
          )}
        >
          {slots.default?.()}
        </SelectViewport>
        <SelectScrollDownButton class="flex cursor-default items-center justify-center py-1">
          <ChevronDownIcon class="size-4" />
        </SelectScrollDownButton>
      </RekaSelectContent>
    </SelectPortal>
  )
}
SelectContent.inheritAttrs = false

type SelectItemProps = Omit<RekaSelectItemProps<AcceptableValue>, 'class'> &
  HTMLAttributes & {
    onSelect?: (event: CustomEvent<{ originalEvent: PointerEvent | KeyboardEvent; value?: AcceptableValue }>) => void
  }

export const SelectItem: FunctionalComponent<SelectItemProps> = (props, { slots }) => {
  const { class: classValue, ...itemProps } = props
  return (
    <RekaSelectItem
      {...itemProps}
      data-slot="select-item"
      class={cn(
        "focus:bg-accent focus:text-accent-foreground [&_svg:not([class*='text-'])]:text-muted-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        classValue,
      )}
    >
      <span class="absolute right-2 flex size-3.5 items-center justify-center">
        <SelectItemIndicator>
          <CheckIcon class="size-4" />
        </SelectItemIndicator>
      </span>
      <SelectItemText>{slots.default?.()}</SelectItemText>
    </RekaSelectItem>
  )
}
SelectItem.inheritAttrs = false
