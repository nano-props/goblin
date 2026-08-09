import { defineComponent } from 'vue'
import { useT } from '#/web/stores/i18n-vue.ts'
import { cn } from '#/web/lib/cn.ts'

export const WorkspaceDropOverlay = defineComponent<{ active: boolean }>({
  name: 'WorkspaceDropOverlay',
  props: { active: Boolean },
  setup(props) {
    const t = useT()
    return () => (
      <div
        aria-hidden={!props.active}
        class={cn(
          'pointer-events-none absolute inset-2 z-50 flex items-center justify-center rounded-xl border-2 border-dashed border-brand bg-background/85 shadow-sm backdrop-blur-sm transition-opacity duration-200 ease-in-out',
          props.active ? 'opacity-100' : 'opacity-0',
        )}
      >
        <div class="rounded-lg border border-border bg-card p-4 text-center shadow-sm">
          <div class="text-sm font-semibold text-foreground">{t('drop.title')}</div>
          <div class="mt-1 text-xs text-muted-foreground">{t('drop.body')}</div>
        </div>
      </div>
    )
  },
})
