# UI and Copy

Use this doc for UI language and presentation rules.

## Loading and dependent reads

- A surface may render its base skeleton while it has no accepted authoritative
  data. Once base data is accepted, keep that UI mounted while independent
  enrichment reads load or fail; localize pending, unavailable, and error
  presentation to the dependent section.
- Do not hide a legitimate skeleton with persisted, previous-key, or store-backed
  fallback data. Do not turn missing enrichment into an empty, zero, clean, or
  otherwise successful state.

- Use Title Case for native menu items.
- Use sentence case for buttons, actions, headings, and help text.
- Use lowercase for status chips such as `open`, `dirty`, and `no upstream`.
- Preserve official casing such as `GitHub`, `VS Code`, and `PR`.
- Preserve raw git and status data such as `M`, `A`, `??`, branch names, and paths.
- Prefer shadcn/ui primitives in `src/web/components/ui/`.
- Reuse shared field primitives for forms.
- Keep layout-level dialog hosts mounted while their dialog is closed, and
  render the Reka root with `open={false}` so exit motion can run; do not
  write `if (!open) return null`. For workspace- or repo-scoped hosts, pass
  the current target as nullable context and close or reconcile stale dialog
  state when that context changes. Capture the initiating workspace or repo
  id in overlay state when opening the dialog rather than reading the live
  active target inside the host.
- Show home-relative paths with `~` via existing `tildify` helpers.
- Focus rings on shadcn primitives use `focusRingInset` / `focusRingVisibleInset`
  from `src/web/components/ui/focus.ts`. These draw the ring _inside_ the
  border box (box-shadow inset), so ancestor `overflow: hidden` /
  `clip-path` / scroll containers can't slice the halo. Concentric outer
  rings are clip-fragile.
- 1px inline dividers go through `<Separator>` from `src/web/components/ui/separator.tsx`.
  Do not hand-roll equivalent inline divider styles. The primitive owns size,
  orientation, and theme behavior. Borders that are part of a surrounding
  surface remain the responsibility of that surface rather than a separate
  divider child.
- Hover-revealed action triggers (e.g. row action menus with
  `opacity-0 group-hover/...:opacity-100`) must also stay visible in
  compact UI — there is no hover affordance — and while the popover
  is open — otherwise the trigger disappears under it. Collapse the
  show-conditions into a single boolean, then render the two branches
  side by side:

  ```tsx
  const alwaysVisible = useIsCompactUi() || open

  class={cn(
    'ml-auto size-5 shrink-0 p-0 transition-opacity duration-100',
    alwaysVisible && 'opacity-100',
    !alwaysVisible && 'opacity-0 group-hover/filetree-row:opacity-100',
  )}
  ```

  Do **not** add a third `cond && '…'` clause to an existing
  `cn(...)` — that patches the same class name twice and buries the
  visibility policy. Add the new condition to the boolean instead.

- Transient status chips (e.g. terminal "Opening…", "Syncing worktree…",
  "Pushing…") must NOT mimic button affordance — no `border`,
  `background`, `box-shadow`, or hover styles. Users will try to click
  them, get no response, and read the surface as broken. Style them as
  passive text (low-weight `muted-foreground`, 11–12 px, `font-weight: 500`)
  with a small animated dot at `currentColor` for the "in progress"
  signal. The chip's host element should set `pointer-events: none`
  and the dot itself must be a real `<span>` child (not a
  pseudo-element) so the host's `pointer-events: none` cascades and the
  dot doesn't swallow clicks meant for the surface underneath. Mount
  the chip in a single stable node across the entire transition window
  — rendering one `<div role="status" aria-live="polite">` per state
  flip causes screen readers to re-announce the same label every time
  Vue unmounts and remounts the node.
