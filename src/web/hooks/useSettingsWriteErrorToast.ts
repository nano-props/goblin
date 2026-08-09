import { onScopeDispose } from 'vue'
import { toast } from 'vue-sonner'
import { useT } from '#/web/stores/i18n-vue.ts'
import { subscribeNativeHostEventType } from '#/web/client-ingress.ts'

export function useSettingsWriteErrorToast(): void {
  const t = useT()
  const unsubscribe = subscribeNativeHostEventType('settings-write-error', (event) => {
    toast.error(t('error.settings-write-title'), { description: event.message })
  })
  onScopeDispose(unsubscribe)
}
