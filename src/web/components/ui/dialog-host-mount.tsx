import type { ReactNode } from 'react'

interface DialogHostMountProps<TTarget> {
  readonly target: TTarget | null | undefined
  readonly children: (target: NonNullable<TTarget>) => ReactNode
}

/**
 * Mount boundary for layout-level dialog hosts.
 *
 * `target` answers whether there is enough app context to mount the host
 * (for example, an active repo). The dialog's own `open` prop must stay
 * inside `children` so Radix can render its closed state and run exit motion.
 */
export function DialogHostMount<TTarget>({ target, children }: DialogHostMountProps<TTarget>) {
  if (target === null || target === undefined) return null
  return <>{children(target)}</>
}
