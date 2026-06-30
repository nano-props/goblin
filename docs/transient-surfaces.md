# Transient Surfaces

Use this doc for temporary UI surfaces that reveal from hover/focus/pointer proximity and may contain anchored floating menus.

## Problem

Zen Mode collapses the branch navigator into a temporary left-side reveal. The reveal opens when the pointer enters the trigger/hit area and closes when the pointer leaves the reveal surface.

Some controls inside that reveal open their own Radix-backed floating surfaces:

- the repository picker opens a repo menu;
- branch rows open branch action menus;
- future sidebar controls may open more `Popover` / `DropdownMenu` content.

Those child menus render through portals and are visually outside the reveal panel's DOM subtree. The existing reveal code recognizes `[data-floating-surface]` during pointer hit-testing, but it only answers "is the pointer currently over a floating surface?" It does not answer "is there an open child floating surface that was launched from this reveal?"

As a result, a child menu can remain open after the Zen Mode reveal auto-hides. That leaves an orphaned menu whose anchor surface has disappeared.

## Design goal

Temporary parent surfaces should not disappear while an anchored child floating surface they spawned is open.

The desired interaction is:

1. A transient surface opens from hover/proximity.
2. The user opens a child menu inside it.
3. The parent surface becomes pinned while the child menu is open.
4. Pointer movement outside the parent does not auto-close it during that pinned period.
5. When the child menu closes, the parent returns to its normal close-on-leave behavior.
6. App-level dialogs triggered from menu actions may outlive the transient surface if their state is explicitly centralized.

This preserves stable menu anchors without lifting row/menu-local state to app-level stores.

## Non-goals

- Do not centralize every row/menu `Popover` in `useAppOverlays`. Anchor-bound transient menus should remain local to their owning component or list.
- Do not make Zen Mode know about specific child controls such as `RepoPicker` or `BranchActionsMenu`.
- Do not close child menus as the primary fix. Closing menus on parent leave avoids orphans, but it makes hover-revealed UI fragile and requires every child menu to expose control state upward.
- Do not replace the Zen Mode reveal with Radix `HoverCard` as part of this fix. The reveal has custom sizing, resize, title-bar, animation-retention, and inert behavior.

## Primitive model

Introduce a UI-layer primitive for transient surfaces with descendant floating-surface pinning.

### `FloatingSurfaceBoundary`

A boundary tracks floating surfaces opened by descendants in the React tree, even when those surfaces render through portals.

Responsibilities:

- expose a provider around the contents of a transient parent surface;
- allow shared floating primitives to report open/closed transitions;
- keep an aggregate `openDescendantCount` rather than identities for specific menus;
- notify the parent when the boundary is pinned (`openDescendantCount > 0`).

This is intentionally generic: it should not import repo, branch, Zen Mode, or workspace modules.

### Shared floating primitive integration

The shared `Popover` wrapper in `src/web/components/ui/popover.tsx` should report its open state to the nearest `FloatingSurfaceBoundary` if one exists.

Rules:

- Controlled and uncontrolled popovers both participate.
- A popover contributes exactly one open unit while its effective `open` state is true.
- On close or unmount, the contribution is removed.
- If there is no boundary provider, behavior is unchanged.
- The reporting should live in the shared wrapper so callers such as `RepoPicker`, `ActionPopover`, and future popovers do not need bespoke code.

`DropdownMenu` can adopt the same boundary reporting later if a transient surface contains dropdown menus. The immediate bug path uses `Popover` via `RepoPicker` and `ActionPopover`.

### `TransientSurface`

A transient surface owns its own open/close policy and consumes boundary pin state.

The primitive contract is:

- parent controls whether the surface is mounted/open/interactive;
- pointer/focus/proximity events may request open or close;
- descendant floating surfaces can pin the parent open;
- while pinned, automatic close-on-leave is suppressed;
- when unpinned, the surface resumes its own close policy.

The first concrete consumer is the Zen Mode sidebar reveal. The implementation can start as a local use of `FloatingSurfaceBoundary` inside `ZenModeSidebarReveal`; if a second transient parent surface appears, extract the repeated policy into a reusable `TransientSurface` component/hook.

## Zen Mode behavior

`ZenModeSidebarReveal` should wrap its sidebar contents in the floating boundary and keep a local `pinnedByDescendantSurface` boolean.

When `pinnedByDescendantSurface` is true:

- pointer-leave handlers should not call `onSurfaceLeave`;
- document-level pointer-move auto-close should be suppressed;
- the reveal remains interactive and visible;
- resize-drag behavior remains unchanged.

When the boundary becomes unpinned:

- normal pointer-leave behavior resumes;
- the next pointer movement outside the reveal may close it;
- optionally, the reveal may immediately re-check the last pointer position and close if it is already outside. This should be implemented only if it does not make menu close animations feel abrupt.

## State ownership

Keep state at the layer that owns the invariant:

| State | Owner |
| --- | --- |
| Repository picker menu open state | `RepoPicker` |
| Branch action menu open row | `BranchList` |
| Zen Mode reveal open/rendered/interactive state | `ZenModeSidebarChrome` / `useZenModeSidebarReveal` |
| "A descendant floating surface pins this transient surface" | `FloatingSurfaceBoundary` inside the transient parent |
| Cross-surface confirmation dialogs | centralized dialog/app overlay state |

This keeps anchor-bound menus close to their anchors while giving transient parents a generic way to remain stable.

## Accessibility and interaction notes

- Pinning must not trap focus. It only suppresses hover/proximity auto-close while a descendant floating surface is open.
- Escape and outside-click behavior remains owned by the child floating primitive.
- When the child menu closes, focus restoration should continue to follow Radix behavior.
- If the parent becomes non-interactive for reasons other than pointer leave, such as exiting Zen Mode, it may still force unpin/close through existing lifecycle cleanup.

## Testing plan

Add tests around the primitive and the Zen Mode consumer:

- A `Popover` opened under a `FloatingSurfaceBoundary` increments the boundary pin state and decrements it on close.
- Unmounting an open popover decrements the boundary contribution.
- Opening the repo picker menu from the Zen Mode reveal prevents pointer-outside auto-close until the menu closes.
- Opening a branch action menu from the Zen Mode reveal has the same behavior through `ActionPopover`.
- With no child menu open, existing Zen Mode close-on-leave behavior is unchanged.

## Migration plan

1. Add the generic floating boundary primitive under `src/web/components/ui/`.
2. Integrate boundary reporting into the shared `Popover` wrapper.
3. Use the boundary in `ZenModeSidebarReveal` to pin the reveal while descendant popovers are open.
4. Add regression tests for repo picker and branch action menus in Zen Mode.
5. If future transient parents need the same policy, extract a reusable `TransientSurface` component/hook from the Zen Mode implementation.
