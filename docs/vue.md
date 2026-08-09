# Vue Development

Use Vue as a typed projection layer over the project's authoritative models.
Keep component contracts explicit, ownership local, and rendering declarative.

## Components

- Write rendered UI in TSX. Do not use `h(...)` in production code, tests,
  fixtures, or examples.
- When a file primarily defines one component, name the file after that
  component in PascalCase, such as `SelectValue.tsx`.
- Use `class`, not `className`, in JSX.
- Give inline CSS lengths explicit units. Vue does not infer `px` from numeric
  values; keep numbers only for genuinely unitless CSS values.
- Define setup-based Vue components with the object form of `defineComponent`
  so the public contract, lifecycle, behavior, and render function stay visible
  in one place.
- Prefer the explicit `FunctionalComponent` type name over a generic `FC`
  alias. When local repetition warrants an alias, name it for its role rather
  than introducing a project-wide abbreviation.
- Prefer a TypeScript interface as the prop type source. TSX still lists prop
  names at runtime so Vue can separate them from attrs. Use runtime prop options
  when defaults, coercion, or runtime validation are part of the contract.
- Required domain inputs remain required and non-null. Component convenience
  must not weaken a domain invariant.
- Treat fallthrough attrs as component behavior, not definition boilerplate.
  Use `inheritAttrs: false` when a component rejects attrs or forwards them to
  one chosen owner; otherwise Vue's default fallthrough remains part of its
  contract.

```tsx
import { defineComponent } from 'vue'

interface ConfirmDialogProps {
  label: string
}

export const ConfirmDialog = defineComponent<ConfirmDialogProps>({
  name: 'ConfirmDialog',
  inheritAttrs: false,

  props: ['label'],

  emits: {
    confirm: () => true,
  },

  setup(props, { attrs, emit }) {
    function confirm() {
      emit('confirm')
    }

    return () => (
      <div class="dialog">
        <button {...attrs} type="button" onClick={confirm}>
          {props.label}
        </button>
      </div>
    )
  },
})
```

## Migration

- Port React components to Vue with TSX first. Preserve reviewable structure and
  data flow while functional parity is being established.
- Preserve runtime props, emits, slots, and attrs behavior when changing a
  component's definition form. Review fallthrough-boundary changes separately.
- Do not mix the framework port with broad component redesign. Remove the React
  path atomically rather than maintaining parallel implementations.
- SFCs are not part of the current toolchain. Introduce SFC compilation, type
  checking, and conventions together in a separate, complete change before
  adding `.vue` files.
- Remove this migration section when the port and its follow-up refactors are
  complete.

## Reactivity and ownership

- Prefer derivation over synchronization. Values derived from props, routes,
  stores, or queries should normally be computed rather than copied into local
  state.
- Use watchers for genuine imperative effects and resource lifetimes, not as a
  workaround for unclear data flow. Each watcher should have one identifiable
  owner, stable inputs, and matching cleanup.
- Keep composables at the top level of `setup`, and keep the returned function
  focused on rendering.
- Tie subscriptions, requests, timers, DOM integrations, and third-party
  instances to the lifetime of the component that owns them.
- Capture the accepted target of an asynchronous action before yielding. A
  later route or prop change must not redirect work already in progress.
- Express conditional ownership with component lifetime instead of nullable
  identities, mirrored state, or compensating effects.

## Boundaries and tests

- Reuse the project's canonical UI, navigation, state, query, i18n, and service
  boundaries. Vue integration must not create a second authority for the same
  fact.
- Keep domain components closed and typed. Forward open-ended attrs only where
  transparent platform adaptation is the component's explicit purpose.
- Tests use the same TSX and component conventions as production code. Await
  Vue updates and verify observable behavior, ownership changes, and cleanup.
- Prefer rules that describe invariants and ownership. Keep library-specific
  mechanics near the integration that owns them so the architecture can evolve
  without compatibility layers.
