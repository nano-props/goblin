import { defineComponent } from 'vue'
import { AppleTerminalIcon } from '#/web/components/ExternalAppIcon/AppleTerminalIcon.tsx'
import { useT } from '#/web/stores/i18n-vue.ts'
import { cn } from '#/web/lib/cn.ts'

export const TerminalOutputActivityIndicator = defineComponent<{ class?: string }>({
  name: 'TerminalOutputActivityIndicator',
  props: { class: String },
  setup(props) {
    const t = useT()
    return () => {
      const label = t('terminal.output-active')
      return (
        <span
          aria-label={label}
          title={label}
          role="img"
          data-testid="terminal-output-activity-indicator"
          class={cn(
            'goblin-terminal-output-activity-indicator inline-flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground',
            props.class,
          )}
        >
          <span class="goblin-terminal-output-activity-indicator__icon-wrap">
            <AppleTerminalIcon class="size-4" />
          </span>
        </span>
      )
    }
  },
})
