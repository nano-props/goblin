import { computed, defineComponent } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import { SETTINGS_PAGES } from '#/shared/settings-pages.ts'
import { useAppRouteNavigation } from '#/web/app/navigation/route-navigation.ts'
import { SettingsPageScreen } from '#/web/components/SettingsPageScreen.tsx'

export const SettingsRouteView = defineComponent({
  name: 'SettingsRouteView',
  setup() {
    const route = useRoute()
    const navigation = useAppRouteNavigation()
    const page = computed(() => SETTINGS_PAGES.find((page) => route.name === `settings-${page}`) ?? 'general')
    return () => (
      <SettingsPageScreen
        page={page.value}
        onBack={() => navigation.closeSettings()}
        onPageChange={(page) => navigation.openSettings(page)}
      >
        <RouterView />
      </SettingsPageScreen>
    )
  },
})
