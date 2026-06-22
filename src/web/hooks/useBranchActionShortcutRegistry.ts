import { useEffect, useRef } from 'react'
import { type BranchActionSurface, visibleBranchActionItems } from '#/web/hooks/useBranchActionItems.ts'
import { setBranchActionShortcutHandler } from '#/web/keyboard/branch-action-shortcuts.ts'

type BranchActionShortcutItems = Pick<BranchActionSurface, 'mainItems' | 'destructiveItems'>

export function useBranchActionShortcutRegistry(actions: BranchActionShortcutItems, enabled = true): void {
  const visibleItems = enabled ? visibleBranchActionItems(actions) : []
  const visibleItemsRef = useRef(visibleItems)
  visibleItemsRef.current = visibleItems

  useEffect(() => {
    if (!enabled) return
    return setBranchActionShortcutHandler((action) => {
      const item = visibleItemsRef.current.find((candidate) => candidate.id === action)
      if (!item || item.disabled) return
      void item.onSelect()
    })
  }, [enabled])
}
