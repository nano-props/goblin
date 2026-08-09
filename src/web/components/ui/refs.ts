import type { Ref, VNodeRef } from 'vue'

export type ElementRef<T> = Ref<T | null> | ((value: T | null) => void)

export function composeRefs<T>(...refs: Array<ElementRef<T> | undefined>): (value: T | null) => void {
  return (value) => {
    for (const target of refs) {
      if (!target) continue
      if (typeof target === 'function') target(value)
      else target.value = value
    }
  }
}

export function toButtonVNodeRef(target: ElementRef<HTMLButtonElement> | undefined): VNodeRef | undefined {
  if (!target) return undefined
  return (value) => setElementRef(target, value instanceof HTMLButtonElement ? value : null)
}

export function toDivVNodeRef(target: ElementRef<HTMLDivElement> | undefined): VNodeRef | undefined {
  if (!target) return undefined
  return (value) => setElementRef(target, value instanceof HTMLDivElement ? value : null)
}

export function toLiVNodeRef(target: ElementRef<HTMLLIElement> | undefined): VNodeRef | undefined {
  if (!target) return undefined
  return (value) => setElementRef(target, value instanceof HTMLLIElement ? value : null)
}

function setElementRef<T>(target: ElementRef<T>, value: T | null): void {
  if (typeof target === 'function') target(value)
  else target.value = value
}
