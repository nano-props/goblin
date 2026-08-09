import { defineComponent } from 'vue'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { TITLE_BAR_HEIGHT_PX } from '#/shared/title-bar-chrome.ts'

export const SettingsContentFrame = defineComponent<{ topInset?: number; title: string }>({
  name: 'SettingsContentFrame',
  props: {
    topInset: Number,
    title: { type: String, required: true },
  },

  setup(props, { slots }) {
    return () => {
      const chromeHeight = (props.topInset ?? 0) > 0 ? props.topInset : TITLE_BAR_HEIGHT_PX
      return (
        <section class="flex min-w-0 flex-1 flex-col bg-background">
          <div class="app-drag-region shrink-0 bg-background" aria-hidden style={{ height: `${chromeHeight}px` }} />
          <ScrollArea class="min-h-0 w-full flex-1 bg-background">
            <div class="w-full space-y-5 px-5 pb-4 pt-4">
              <h1 class="truncate text-2xl font-semibold tracking-normal text-foreground">{props.title}</h1>
              {slots.default?.()}
            </div>
          </ScrollArea>
        </section>
      )
    }
  },
})
