import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { ellipsizeLeftPathByWidth } from '#/web/lib/display-path.ts'
import { cn } from '#/web/lib/cn.ts'
interface Props {
  path: string
  className?: string
}

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

export function FilePathText({ path, className }: Props) {
  const ref = useRef<HTMLSpanElement | null>(null)
  const [displayPath, setDisplayPath] = useState(path)

  const update = useCallback(() => {
    const element = ref.current
    if (!element) return

    const availableWidth = element.getBoundingClientRect().width || element.clientWidth
    const measureText = createTextWidthMeasurer(element)
    const nextPath = ellipsizeLeftPathByWidth(path, availableWidth, measureText)
    setDisplayPath((current) => (current === nextPath ? current : nextPath))
  }, [path])

  useLayoutEffect(() => {
    update()
  })

  useLayoutEffect(() => {
    if (!window.ResizeObserver) {
      window.addEventListener('resize', update)
      return () => window.removeEventListener('resize', update)
    }

    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [update])

  return (
    <span
      ref={ref}
      className={cn(
        'block w-full min-w-0 overflow-hidden whitespace-nowrap text-sm text-foreground font-mono',
        className,
      )}
      title={path}
      aria-label={path}
    >
      {displayPath}
    </span>
  )
}
