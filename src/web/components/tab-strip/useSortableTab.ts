import type { ComponentPropsWithoutRef, KeyboardEvent } from 'react'
import type { DraggableAttributes } from '@dnd-kit/core'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { omit } from 'es-toolkit'

interface UseSortableTabResult {
  attributes: DraggableAttributes
  sortableListeners: ComponentPropsWithoutRef<'div'>
  sortableOnKeyDown: ((event: KeyboardEvent) => void) | undefined
  setContainerRef: (node: HTMLElement | null) => void
  setButtonRef: (node: HTMLButtonElement | null) => void
  style: { transform: string | undefined; transition: string | undefined }
  isDragging: boolean
}

export function useSortableTab(
  id: string,
  options?: { disabled?: boolean; onButtonRef?: (node: HTMLButtonElement | null) => void },
): UseSortableTabResult {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: options?.disabled,
  })
  const sortableOnKeyDown = listeners?.onKeyDown as ((event: KeyboardEvent) => void) | undefined
  const sortableListeners = omit((listeners ?? {}) as ComponentPropsWithoutRef<'div'>, ['onKeyDown'])
  const chromeLikeTransform = transform ? { ...transform, y: 0, scaleX: 1, scaleY: 1 } : null
  const style = {
    transform: CSS.Transform.toString(chromeLikeTransform) ?? undefined,
    transition,
  }

  const setButtonRef = (node: HTMLButtonElement | null) => {
    setActivatorNodeRef(node)
    options?.onButtonRef?.(node)
  }

  return {
    attributes,
    sortableListeners,
    sortableOnKeyDown,
    setContainerRef: setNodeRef as (node: HTMLElement | null) => void,
    setButtonRef,
    style,
    isDragging,
  }
}
