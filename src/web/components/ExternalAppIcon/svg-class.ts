import type { HTMLAttributes } from 'vue'
import { cn } from '#/web/lib/cn.ts'
export function svgClass(classValue: HTMLAttributes['class']): string {
  return cn('pointer-events-none size-3.5 shrink-0', classValue)
}
