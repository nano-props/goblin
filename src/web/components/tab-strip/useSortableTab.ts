import type { ComponentPropsWithoutRef, KeyboardEvent } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface UseSortableTabResult {
  attributes: Record<string, unknown>
  sortableListeners: ComponentPropsWithoutRef<'div'>
  sortableOnKeyDown: ((event: KeyboardEvent) => void) | undefined
  setContainerRef: (node: HTMLElement | null) => void
  setButtonRef: (node: HTMLButtonElement | null) => void
  style: { transform: string | undefined; transition: string | undefined }
  isDragging: boolean
}

export function useSortableTab(
  id: string,
  options?: { onButtonRef?: (node: HTMLButtonElement | null) => void },
): UseSortableTabResult {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
  })
  const sortableOnKeyDown = listeners?.onKeyDown as ((event: KeyboardEvent) => void) | undefined
  const { onKeyDown: _sortableOnKeyDown, ...sortableListeners } = (listeners ?? {}) as ComponentPropsWithoutRef<'div'>
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
    attributes: attributes as unknown as Record<string, unknown>,
    sortableListeners,
    sortableOnKeyDown,
    setContainerRef: setNodeRef as (node: HTMLElement | null) => void,
    setButtonRef,
    style,
    isDragging,
  }
}
