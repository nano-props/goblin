import { SwitchRoot, SwitchThumb } from 'reka-ui'
import type { SwitchRootProps } from 'reka-ui'
import type { FunctionalComponent, HTMLAttributes } from 'vue'
import { cn } from '#/web/lib/cn.ts'
import { focusRingVisibleInset } from '#/web/components/ui/focus.ts'

type SwitchProps = Omit<SwitchRootProps<boolean>, 'class'> &
  HTMLAttributes & {
    'onUpdate:modelValue'?: (value: boolean) => void
  }

export const Switch: FunctionalComponent<SwitchProps> = (props) => {
  const { class: classValue, ...rootProps } = props
  return (
    <SwitchRoot
      {...rootProps}
      data-slot="switch"
      class={cn(
        'peer inline-flex h-[22px] w-10 shrink-0 cursor-pointer items-center rounded-full border border-border/70 bg-accent p-0.5 shadow-xs transition-colors duration-100 outline-none focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary',
        focusRingVisibleInset,
        classValue,
      )}
    >
      <SwitchThumb
        data-slot="switch-thumb"
        class="pointer-events-none block size-[18px] rounded-full bg-background shadow-sm ring-0 transition-transform duration-100 data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0"
      />
    </SwitchRoot>
  )
}
Switch.inheritAttrs = false
