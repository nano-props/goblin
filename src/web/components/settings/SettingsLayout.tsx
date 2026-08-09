import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import { SettingsContentFrame } from '#/web/components/settings/SettingsContentFrame.tsx'
import { SettingsSidebar } from '#/web/components/settings/SettingsSidebar.tsx'
import { useT } from '#/web/stores/i18n-vue.ts'
import { SETTINGS_PAGE_CONFIG, SETTINGS_PAGES } from '#/shared/settings-pages.ts'
import type { SettingsPage } from '#/shared/settings-pages.ts'
import { GitHubMark } from '#/web/components/GitHubMark.tsx'
import {
  AppWindow,
  Bell,
  Info,
  Keyboard,
  Router,
  Settings2,
  Shield,
  SlidersHorizontal,
  type LucideIcon,
} from '@lucide/vue'

const SETTINGS_PAGE_ICONS = {
  general: Settings2,
  shortcuts: Keyboard,
  notifications: Bell,
  ssh: Shield,
  sync: SlidersHorizontal,
  apps: AppWindow,
  github: GitHubMark,
  web: Router,
  about: Info,
} as const satisfies Record<SettingsPage, LucideIcon | typeof GitHubMark>

export const SettingsLayout = defineComponent<{
  page: SettingsPage
  topInset?: number
  autoFocusSelected?: boolean
  onBack?: () => void
  onPageChange?: (page: SettingsPage) => void
}>({
  name: 'SettingsLayout',
  props: {
    page: { type: String as PropType<SettingsPage>, required: true },
    topInset: Number,
    autoFocusSelected: { type: Boolean, default: true },
    onBack: Function as PropType<() => void>,
    onPageChange: Function as PropType<(page: SettingsPage) => void>,
  },

  setup(props, { slots }) {
    const t = useT()
    return () => {
      const items = SETTINGS_PAGES.map((pageKey) => {
        const config = SETTINGS_PAGE_CONFIG[pageKey]
        return {
          page: pageKey,
          label: t(config.labelKey),
          title: t(config.titleKey),
          Icon: SETTINGS_PAGE_ICONS[pageKey],
        }
      })
      const active = items.find((item) => item.page === props.page) ?? items[0]!
      return (
        <div class="relative flex h-full min-h-0 w-full min-w-0 flex-1 bg-background">
          <SettingsSidebar
            page={props.page}
            items={items}
            topInset={props.topInset}
            autoFocusSelected={props.autoFocusSelected}
            ariaLabel={t('settings.title')}
            onBack={props.onBack}
            onPageChange={(nextPage) => props.onPageChange?.(nextPage)}
          />
          <SettingsContentFrame topInset={props.topInset} title={active.title}>
            {slots.default?.()}
          </SettingsContentFrame>
        </div>
      )
    }
  },
})
