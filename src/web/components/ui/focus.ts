export const focusRing =
  'focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring'

export const dataActiveRing =
  'data-[active=true]:-outline-offset-2 data-[active=true]:outline-2 data-[active=true]:outline-solid data-[active=true]:outline-ring'

export const compositeFocusRing =
  '[&:has(:focus-visible)]:-outline-offset-2 [&:has(:focus-visible)]:outline-2 [&:has(:focus-visible)]:outline-solid [&:has(:focus-visible)]:outline-ring'

// Inset rings remain visible inside clipped and scrollable containers.
export const focusRingInset = 'focus:ring-2 focus:ring-inset focus:ring-ring'

export const focusRingVisibleInset = 'focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50'
