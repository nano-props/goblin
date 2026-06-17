import * as React from 'react'
import { Switch as SwitchPrimitive } from 'radix-ui'
import { cn } from '#/web/lib/cn.ts'
import { focusRingVisibleInset } from '#/web/components/ui/focus.ts'
function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer inline-flex h-[22px] w-10 shrink-0 cursor-pointer items-center rounded-full border border-border/70 bg-accent p-0.5 shadow-xs transition-colors duration-100 outline-none focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary',
        focusRingVisibleInset,
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          'pointer-events-none block size-[18px] rounded-full bg-background shadow-sm ring-0 transition-transform duration-100 data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0',
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
