import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from '@lucide/vue'
import { Toaster as VueSonner } from 'vue-sonner'
import type { ToasterProps } from 'vue-sonner'
import { defineComponent } from 'vue'
import type { CSSProperties, FunctionalComponent } from 'vue'
import { themeStore } from '#/web/stores/theme.ts'
import { useStoreSelector } from '#/web/stores/store-selector.ts'

const ToastSuccessIcon: FunctionalComponent = () => <CircleCheckIcon class="size-4" />
const ToastInfoIcon: FunctionalComponent = () => <InfoIcon class="size-4" />
const ToastWarningIcon: FunctionalComponent = () => <TriangleAlertIcon class="size-4" />
const ToastErrorIcon: FunctionalComponent = () => <OctagonXIcon class="size-4" />
const ToastLoadingIcon: FunctionalComponent = () => <Loader2Icon class="size-4 animate-spin" />

type ToastStyle = CSSProperties & Record<`--${string}`, string>

export const Toaster = defineComponent<ToasterProps>({
  name: 'Toaster',
  inheritAttrs: false,
  props: ['toastOptions', 'class', 'style'],

  setup(props, { attrs }) {
    const theme = useStoreSelector(themeStore, (state) => state.resolved)

    return () => {
      const classes = props.toastOptions?.classes
      const style: ToastStyle = {
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
        ...props.style,
      }

      return (
        <VueSonner
          {...attrs}
          theme={theme.value}
          class={['toaster group', props.class].filter(Boolean).join(' ')}
          icons={{
            success: ToastSuccessIcon,
            info: ToastInfoIcon,
            warning: ToastWarningIcon,
            error: ToastErrorIcon,
            loading: ToastLoadingIcon,
          }}
          style={style}
          toastOptions={{
            ...props.toastOptions,
            classes: {
              ...classes,
              toast: ['max-w-[calc(100vw-2rem)]', classes?.toast].filter(Boolean).join(' '),
              content: ['min-w-0 max-w-full overflow-hidden', classes?.content].filter(Boolean).join(' '),
              title: ['min-w-0 max-w-full', classes?.title].filter(Boolean).join(' '),
              description: ['min-w-0 max-w-full overflow-hidden', classes?.description].filter(Boolean).join(' '),
            },
          }}
        />
      )
    }
  },
})
