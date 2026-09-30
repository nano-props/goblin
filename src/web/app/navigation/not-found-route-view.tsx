import { defineComponent } from 'vue'
import { EmptyState } from '#/web/components/EmptyState.tsx'
import { Button } from '#/web/components/ui/button.tsx'
import { useAppRouteNavigation } from '#/web/app/navigation/route-navigation.ts'
import { useT } from '#/web/stores/i18n-vue.ts'

export const AppNotFoundRouteView = defineComponent({
  name: 'AppNotFoundRouteView',
  setup() {
    const t = useT()
    const navigation = useAppRouteNavigation()
    return () => (
      <EmptyState
        title={t('route.not-found-title')}
        body={
          <div class="pt-2">
            <Button type="button" variant="outline" onClick={() => navigation.openHome()}>
              {t('route.not-found-home')}
            </Button>
          </div>
        }
      />
    )
  },
})
