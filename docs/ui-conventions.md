# UI and Copy

Use this doc for UI language and presentation rules.

- Use Title Case for native menu items.
- Use sentence case for buttons, actions, headings, and help text.
- Use lowercase for status chips such as `open`, `dirty`, and `no upstream`.
- Preserve official casing such as `GitHub`, `VS Code`, and `PR`.
- Preserve raw git and status data such as `M`, `A`, `??`, branch names, and paths.
- Prefer shadcn/ui primitives in `src/web/components/ui/`.
- Reuse shared field primitives for forms.
- Show home-relative paths with `~` via existing `tildify` helpers.
- Focus rings on shadcn primitives use `focusRingInset` / `focusRingVisibleInset`
  from `src/web/components/ui/focus.ts`. These draw the ring _inside_ the
  border box (box-shadow inset), so ancestor `overflow: hidden` /
  `clip-path` / scroll containers can't slice the halo. Concentric outer
  rings are clip-fragile — the `AnimateHeight` height transition was
  previously clipping Input's left/right focus halo mid-animation.
- 1px inline dividers go through `<Separator>` from `src/web/components/ui/separator.tsx`.
  Don't hand-roll `bg-separator w-px` or `border-l border-separator` —
  these used to drift in height across files (h-4 vs h-5) and in
  implementation (background fill vs left/right border). `Separator`
  defaults to `orientation="horizontal"` / `size="sm"`. For an inline
  vertical seam between toolbar siblings, use `<Separator orientation="vertical" />`
  (renders `h-4 w-px bg-separator`) and let the caller's `relative`
  parent add `absolute left-0|right-0 top-1/2 -translate-y-1/2` via
  `className` when the seam must overlay without consuming layout width.
  The chunkier `size="md"` (`h-5`) is reserved for any future 40px+
  toolbar — no current caller. Larger surface dividers (the workspace
  toolbar's own `border-b`, the sidebar's `border-r`, list `divide-y`)
  stay on Tailwind border utilities; they belong to the surrounding
  container's box, not a separate child element. All separators read
  their color from `--color-separator` (= `--goblin-border-subtle`,
  one notch weaker than `--color-border`).
- Hover-revealed action triggers (e.g. row action menus with
  `opacity-0 group-hover/...:opacity-100`) must also stay visible in
  compact UI — there is no hover affordance — and while the popover
  is open — otherwise the trigger disappears under it. Collapse the
  show-conditions into a single boolean, then render the two branches
  side by side:

  ```tsx
  const alwaysVisible = useIsCompactUi() || open

  triggerClassName={cn(
    'ml-auto size-5 shrink-0 p-0 transition-opacity duration-100',
    alwaysVisible && 'opacity-100',
    !alwaysVisible && 'opacity-0 group-hover/filetree-row:opacity-100',
  )}
  ```

  Do **not** add a third `cond && '…'` clause to an existing
  `cn(...)` — that patches the same class name twice and buries the
  visibility policy. Add the new condition to the boolean instead.
