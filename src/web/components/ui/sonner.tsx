// shadcn/ui Sonner Toaster. Adjusted from the upstream template:
// upstream pulls theme from `next-themes`, which doesn't fit because
// this project owns its own theme store (useThemeStore). We read from
// there instead so the toast theme tracks html[data-theme].

import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from 'lucide-react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'
import { useThemeStore } from '#/web/stores/theme.ts'

const Toaster = ({ toastOptions, className, style, ...props }: ToasterProps) => {
  const theme = useThemeStore((s) => s.resolved)
  const classNames = toastOptions?.classNames

  return (
    <Sonner
      {...props}
      theme={theme}
      className={['toaster group', className].filter(Boolean).join(' ')}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      // Drive sonner's per-state colours via its CSS-var hooks. Body
      // stays neutral (popover-coloured); semantic meaning rides on
      // the icon colour set above.
      //
      // NOTE: token names are `--color-popover` / `--color-border`
      // (Tailwind v4 `@theme` prefixes them with `--color-`). The
      // upstream shadcn template references `--popover` / `--border`
      // because it targets Tailwind v3 — copying that as-is would
      // resolve to `unset` and the toast renders translucent over
      // the page (the symptom of "semi-transparent toasts").
      style={
        {
          '--normal-bg': 'var(--color-popover)',
          '--normal-text': 'var(--color-popover-foreground)',
          '--normal-border': 'var(--color-border)',
          '--success-bg': 'var(--color-popover)',
          '--success-text': 'var(--color-success)',
          '--success-border': 'var(--color-border)',
          '--error-bg': 'var(--color-popover)',
          '--error-text': 'var(--color-danger)',
          '--error-border': 'var(--color-border)',
          '--warning-bg': 'var(--color-popover)',
          '--warning-text': 'var(--color-warning)',
          '--warning-border': 'var(--color-border)',
          '--info-bg': 'var(--color-popover)',
          '--info-text': 'var(--color-brand)',
          '--info-border': 'var(--color-border)',
          '--border-radius': 'var(--radius)',
          '--width': 'min(520px, calc(100vw - 2rem))',
          ...style,
        } as React.CSSProperties
      }
      toastOptions={{
        ...toastOptions,
        classNames: {
          ...classNames,
          toast: ['max-w-[calc(100vw-2rem)]', classNames?.toast].filter(Boolean).join(' '),
          content: ['min-w-0 max-w-full overflow-hidden', classNames?.content].filter(Boolean).join(' '),
          title: ['min-w-0 max-w-full', classNames?.title].filter(Boolean).join(' '),
          description: ['min-w-0 max-w-full overflow-hidden', classNames?.description].filter(Boolean).join(' '),
        },
      }}
    />
  )
}

export { Toaster }
