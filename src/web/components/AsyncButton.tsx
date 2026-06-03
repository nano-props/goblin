import type { ComponentProps, MouseEvent, ReactNode } from 'react'
import { Button } from '#/web/components/ui/button.tsx'
import { useAsyncPending } from '#/web/hooks/useAsyncPending.ts'
interface AsyncButtonState {
  pending: boolean
  busy: boolean
}

type AsyncButtonProps = Omit<ComponentProps<typeof Button>, 'children' | 'onClick'> & {
  loading?: boolean
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void | Promise<unknown>
  children: ReactNode | ((state: AsyncButtonState) => ReactNode)
}

export function AsyncButton({ children, disabled, loading = false, onClick, ...props }: AsyncButtonProps) {
  const { isPending, run } = useAsyncPending<'click'>()
  // `pending` is this button's own click promise and auto-disables to prevent
  // double-submit. External `loading` is visual only; callers decide whether
  // that work should also disable the button.
  const busy = isPending || loading

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    void run('click', () => onClick?.(event))
  }

  return (
    <Button {...props} disabled={disabled || isPending} aria-busy={busy ? true : undefined} onClick={handleClick}>
      {typeof children === 'function' ? children({ pending: isPending, busy }) : children}
    </Button>
  )
}
