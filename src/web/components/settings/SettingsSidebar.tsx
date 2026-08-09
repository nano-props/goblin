import { ArrowLeft } from '@lucide/vue'
import { defineComponent, ref, watch } from 'vue'
import type { FunctionalComponent, PropType, SVGAttributes } from 'vue'
import { Button } from '#/web/components/ui/button.tsx'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { useResponsiveUiMode } from '#/web/hooks/useResponsiveUiMode.tsx'
import { cn } from '#/web/lib/cn.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import { TITLE_BAR_HEIGHT_PX } from '#/shared/title-bar-chrome.ts'
import { SidebarRowButton } from '#/web/components/ui/sidebar-row-button.tsx'
import type { SettingsPage } from '#/shared/settings-pages.ts'

export interface SettingsSidebarItem {
  page: SettingsPage
  label: string
  Icon: FunctionalComponent<SVGAttributes>
}

export const SettingsSidebar = defineComponent<{
  page: SettingsPage
  items: readonly SettingsSidebarItem[]
  topInset?: number
  autoFocusSelected?: boolean
  ariaLabel: string
  onBack?: () => void
  onPageChange: (page: SettingsPage) => void
}>({
  name: 'SettingsSidebar',
  props: {
    page: { type: String as PropType<SettingsPage>, required: true },
    items: { type: Array as PropType<readonly SettingsSidebarItem[]>, required: true },
    topInset: Number,
    autoFocusSelected: { type: Boolean, default: true },
    ariaLabel: { type: String, required: true },
    onBack: Function as PropType<() => void>,
    onPageChange: { type: Function as PropType<(page: SettingsPage) => void>, required: true },
  },

  setup(props) {
    const t = useT()
    const uiMode = useResponsiveUiMode()
    const navigation = ref<HTMLElement | null>(null)

    // Focus follows the selected DOM row itself, so the initial mount and later
    // settings navigation share one post-render readiness boundary.
    watch(
      [navigation, () => props.autoFocusSelected, () => props.page],
      () => {
        if (props.autoFocusSelected === false) return
        navigation.value?.querySelector<HTMLButtonElement>('[aria-current="page"]')?.focus()
      },
      { flush: 'post' },
    )

    return () => {
      const compact = uiMode.value === 'compact'
      const chromeHeight = (props.topInset ?? 0) > 0 ? props.topInset : TITLE_BAR_HEIGHT_PX
      return (
        <aside
          class={cn(
            'flex h-full shrink-0 flex-col border-r border-border/60 bg-navigation pb-3',
            compact ? 'w-16 px-2' : 'w-64 px-3',
          )}
        >
          <div class="app-drag-region shrink-0" aria-hidden style={{ height: `${chromeHeight}px` }} />
          {props.onBack ? (
            <Button
              type="button"
              variant="ghost"
              size={compact ? 'icon-lg' : 'default'}
              class={cn(
                'mb-3 text-muted-foreground',
                compact ? 'mx-auto size-9' : 'h-9 w-full justify-start gap-2 px-2.5',
              )}
              aria-label={t('settings.back')}
              onClick={props.onBack}
            >
              <ArrowLeft />
              <span class={compact ? 'hidden' : 'truncate'}>{t('settings.back')}</span>
            </Button>
          ) : null}

          <ScrollArea class="min-h-0 flex-1" scrollbarMode="compact">
            <nav ref={navigation} class="space-y-1.5 pb-3" aria-label={props.ariaLabel}>
              {props.items.map((item) => {
                const Icon = item.Icon
                const selected = props.page === item.page
                return (
                  <SidebarRowButton
                    key={item.page}
                    onClick={() => props.onPageChange(item.page)}
                    selected={selected}
                    size={compact ? 'icon' : 'compact'}
                    class={cn('font-normal', compact ? 'mx-auto' : 'justify-start')}
                    contentClass={cn(compact ? 'hidden' : 'truncate', selected ? 'font-medium' : 'font-normal')}
                    leading={
                      <Icon
                        class={cn('size-4 shrink-0', selected ? 'text-selected-foreground' : 'text-muted-foreground')}
                      />
                    }
                    aria-label={item.label}
                    aria-current={selected ? 'page' : undefined}
                  >
                    {item.label}
                  </SidebarRowButton>
                )
              })}
            </nav>
          </ScrollArea>
        </aside>
      )
    }
  },
})
