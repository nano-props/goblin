import type { FunctionalComponent, SVGAttributes } from 'vue'
import { svgClass } from '#/web/components/ExternalAppIcon/svg-class.ts'
export const AppleTerminalIcon: FunctionalComponent<SVGAttributes> = ({ class: classValue, ...props }) => {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" class={svgClass(classValue)} {...props}>
      <rect x="8" y="12" width="48" height="40" rx="8" fill="none" stroke="currentColor" stroke-width="5" />
      <path
        d="m20 27 8 6-8 6M34 40h12"
        fill="none"
        stroke="currentColor"
        stroke-width="5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}
AppleTerminalIcon.inheritAttrs = false
