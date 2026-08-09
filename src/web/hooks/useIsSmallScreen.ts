import { useMediaQuery } from '@vueuse/core'
import type { ComputedRef } from 'vue'

const SMALL_SCREEN_MEDIA_QUERY = '(max-width: 639px)'

export function useIsSmallScreen(): ComputedRef<boolean> {
  return useMediaQuery(SMALL_SCREEN_MEDIA_QUERY)
}
