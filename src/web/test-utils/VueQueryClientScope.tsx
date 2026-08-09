import { VUE_QUERY_CLIENT } from '@tanstack/vue-query'
import type { QueryClient } from '@tanstack/vue-query'
import { defineComponent, onScopeDispose, provide } from 'vue'
import type { PropType } from 'vue'

interface VueQueryClientScopeProps {
  client: QueryClient
}

export const VueQueryClientScope = defineComponent<VueQueryClientScopeProps>({
  name: 'VueQueryClientScope',
  inheritAttrs: false,
  props: {
    client: { type: Object as PropType<QueryClient>, required: true },
  },
  setup(props, { slots }) {
    const client = props.client
    client.mount()
    provide(VUE_QUERY_CLIENT, client)
    onScopeDispose(() => client.unmount())
    return () => slots.default?.()
  },
})
