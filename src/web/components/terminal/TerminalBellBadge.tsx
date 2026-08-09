import { defineComponent } from 'vue'
import { useT } from '#/web/stores/i18n-vue.ts'

export const TerminalBellBadge = defineComponent<{ count: number }>({
  name: 'TerminalBellBadge',
  props: { count: { type: Number, required: true } },
  setup(props) {
    const t = useT()
    return () => {
      if (props.count <= 0) return null
      const label = t('terminal.bell-unread-count', { count: props.count })
      const displayCount = props.count > 99 ? '99+' : String(props.count)
      return (
        <span
          aria-label={label}
          title={label}
          class="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-notification px-1 font-mono text-[10px] font-semibold leading-none text-notification-foreground tabular-nums"
        >
          {displayCount}
        </span>
      )
    }
  },
})
