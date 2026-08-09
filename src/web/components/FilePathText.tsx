import { useResizeObserver } from '@vueuse/core'
import { defineComponent, onMounted, ref, watch } from 'vue'
import { ellipsizeLeftPathByWidth } from '#/web/lib/display-path.ts'
import { cn } from '#/web/lib/cn.ts'

let measureCanvas: HTMLCanvasElement | null = null

function createTextWidthMeasurer(element: HTMLElement): (text: string) => number {
  const style = window.getComputedStyle(element)
  measureCanvas ??= document.createElement('canvas')
  const context = measureCanvas.getContext('2d')
  const fontSize = Number.parseFloat(style.fontSize) || 12
  const fallbackWidth = fontSize * 0.6
  const parsedLetterSpacing = Number.parseFloat(style.letterSpacing)
  const letterSpacing = Number.isFinite(parsedLetterSpacing) ? parsedLetterSpacing : 0

  if (context) {
    context.font = [style.fontStyle, style.fontVariant, style.fontWeight, style.fontSize, style.fontFamily].join(' ')
  }

  return (text: string) => {
    if (text.length === 0) return 0
    const glyphWidth = context ? context.measureText(text).width : text.length * fallbackWidth
    return glyphWidth + Math.max(0, text.length - 1) * letterSpacing
  }
}

export const FilePathText = defineComponent<{ path: string; class?: string }>({
  name: 'FilePathText',
  props: { path: { type: String, required: true }, class: String },
  setup(props) {
    const element = ref<HTMLSpanElement | null>(null)
    const displayPath = ref(props.path)

    function update(): void {
      if (!element.value) return
      const availableWidth = element.value.getBoundingClientRect().width || element.value.clientWidth
      displayPath.value = ellipsizeLeftPathByWidth(props.path, availableWidth, createTextWidthMeasurer(element.value))
    }

    useResizeObserver(element, update)
    onMounted(update)
    // Path and typography-class changes do not necessarily resize the
    // host, so explicitly remeasure after Vue commits either input.
    watch(
      [() => props.path, () => props.class],
      ([path], [previousPath]) => {
        if (path !== previousPath) displayPath.value = path
        update()
      },
      { flush: 'post' },
    )

    return () => (
      <span
        ref={element}
        class={cn(
          'block w-full min-w-0 overflow-hidden whitespace-nowrap text-sm text-foreground font-mono',
          props.class,
        )}
        title={props.path}
        aria-label={props.path}
      >
        {displayPath.value}
      </span>
    )
  },
})
