import type { DetailTab } from '#/renderer/stores/repos/types.ts'

export const DETAIL_TABS = [
  { id: 'status', labelKey: 'tab.status' },
  { id: 'changes', labelKey: 'tab.changes' },
  { id: 'commits', labelKey: 'tab.log' },
] as const satisfies readonly { id: DetailTab; labelKey: string }[]

export function adjacentDetailTab(current: DetailTab, direction: 1 | -1): DetailTab {
  const index = DETAIL_TABS.findIndex((tab) => tab.id === current)
  return DETAIL_TABS[(index + direction + DETAIL_TABS.length) % DETAIL_TABS.length].id
}
