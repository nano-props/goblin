import { defineComponent, nextTick, onMounted, onScopeDispose, onUpdated, ref, watch } from 'vue'

interface CollapseTransitionProps {
  duration?: number
  present?: boolean
}

export const CollapseTransition = defineComponent<CollapseTransitionProps>({
  name: 'CollapseTransition',
  props: {
    duration: Number,
    present: { type: Boolean, default: true },
  },

  setup(props, { slots }) {
    const outerRef = ref<HTMLDivElement | null>(null)
    const innerRef = ref<HTMLDivElement | null>(null)
    const rendered = ref(props.present ?? true)
    let initial = true
    let targetHeight = 0
    let frame: number | null = null

    const duration = () => props.duration ?? 200

    const resize = () => {
      const outer = outerRef.value
      if (!outer) return
      const height = props.present === false ? 0 : (innerRef.value?.scrollHeight ?? 0)
      if (Math.abs(height - targetHeight) <= 0.5) {
        if (props.present === false) rendered.value = false
        return
      }
      outer.style.overflow = 'hidden'
      outer.style.overflowClipMargin = '4px'
      outer.style.height = `${height}px`
      outer.style.opacity = props.present !== false && height > 0 ? '1' : '0'
      targetHeight = height
    }

    onMounted(() => {
      const outer = outerRef.value
      if (!outer) return
      outer.style.transition = 'none'
      const height = props.present === false ? 0 : (innerRef.value?.scrollHeight ?? 0)
      outer.style.height = `${height}px`
      outer.style.opacity = props.present !== false && height > 0 ? '1' : '0'
      targetHeight = height
      initial = false
      frame = requestAnimationFrame(() => {
        frame = null
        outer.style.transition = `height ${duration()}ms ease-in-out, opacity ${duration()}ms ease-in-out`
      })
    })

    // `present` is an external controlled signal. The leaving slot must stay
    // mounted until its height transition commits, so this synchronization is
    // intentionally tied to the prop rather than inferred from render events.
    watch(
      () => props.present,
      async (present) => {
        if (present !== false) {
          rendered.value = true
          await nextTick()
        }
        if (!initial) resize()
      },
      { flush: 'post' },
    )

    onUpdated(() => {
      if (!initial && props.present !== false) resize()
    })

    onScopeDispose(() => {
      if (frame !== null) cancelAnimationFrame(frame)
    })

    const onTransitionend = (event: TransitionEvent) => {
      if (event.currentTarget !== outerRef.value) return
      const outer = outerRef.value
      if (!outer) return
      if (props.present === false) rendered.value = false
      else outer.style.height = 'auto'
      outer.style.overflow = ''
      outer.style.overflowClipMargin = ''
    }

    return () => (
      <div ref={outerRef} onTransitionend={onTransitionend}>
        {rendered.value ? <div ref={innerRef}>{slots.default?.()}</div> : null}
      </div>
    )
  },
})
