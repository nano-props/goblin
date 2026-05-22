import { useLayoutEffect, useRef, useState } from 'react'
import { ellipsizeMiddlePath } from '#/renderer/lib/display-path.ts'

interface Props {
  path: string
}

let measureCanvas: HTMLCanvasElement | null = null

function getCharacterCapacity(element: HTMLElement): number {
  const style = window.getComputedStyle(element)
  measureCanvas ??= document.createElement('canvas')
  const context = measureCanvas.getContext('2d')
  const fontSize = Number.parseFloat(style.fontSize) || 12
  const fallbackWidth = fontSize * 0.6

  if (!context) return Math.floor(element.clientWidth / fallbackWidth)

  context.font = [style.fontStyle, style.fontVariant, style.fontWeight, style.fontSize, style.fontFamily].join(' ')
  const characterWidth = context.measureText('0').width || fallbackWidth
  return Math.max(0, Math.floor(element.clientWidth / characterWidth))
}

export function FilePathText({ path }: Props) {
  const ref = useRef<HTMLSpanElement | null>(null)
  const [maxChars, setMaxChars] = useState<number | null>(null)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return

    const update = () => {
      const nextMaxChars = getCharacterCapacity(element)
      setMaxChars((current) => (current === nextMaxChars ? current : nextMaxChars))
    }

    update()
    if (!window.ResizeObserver) {
      window.addEventListener('resize', update)
      return () => window.removeEventListener('resize', update)
    }

    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <span
      ref={ref}
      className="truncate text-sm text-foreground font-mono flex-1 min-w-0"
      title={path}
      aria-label={path}
    >
      {maxChars === null ? path : ellipsizeMiddlePath(path, maxChars)}
    </span>
  )
}
