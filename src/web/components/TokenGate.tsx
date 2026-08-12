import { defineComponent, onScopeDispose, ref } from 'vue'
import type { PropType } from 'vue'
import { decodeWith } from '#/shared/http-response-schema.ts'
import { OkResponseSchema } from '#/shared/settings-response-schema.ts'
import { useAuth } from '#/web/auth/AuthProvider.tsx'
import { CenteredLoadingStatus } from '#/web/components/CenteredLoadingStatus.tsx'
import { createTimeoutAbortController } from '#/web/lib/abort.ts'
import { postServerCommandJson } from '#/web/lib/server-fetch.ts'
import { useT } from '#/web/stores/i18n-vue.ts'

const LOGIN_TIMEOUT_MS = 15_000

export const TokenGate = defineComponent({
  name: 'TokenGate',
  setup(_props, { slots }) {
    const auth = useAuth()
    return () => {
      if (auth.state === 'checking') return <CenteredLoadingStatus label="Checking authentication" />
      if (auth.state === 'unauthenticated') return <LoginForm onSuccess={auth.refresh} />
      return slots.default?.()
    }
  },
})

const LoginForm = defineComponent<{ onSuccess: () => void }>({
  name: 'LoginForm',
  props: {
    onSuccess: { type: Function as PropType<() => void>, required: true },
  },

  setup(props) {
    const t = useT()
    const value = ref('')
    const error = ref<string | null>(null)
    const submitting = ref(false)
    let activeTimeout: ReturnType<typeof createTimeoutAbortController> | null = null

    const submit = async () => {
      if (submitting.value) return
      const trimmed = value.value.trim()
      if (trimmed.length === 0) {
        error.value = t('auth.gate.error-empty')
        return
      }
      submitting.value = true
      error.value = null
      const onSuccess = props.onSuccess
      const timeout = createTimeoutAbortController(LOGIN_TIMEOUT_MS, `login timed out after ${LOGIN_TIMEOUT_MS}ms`)
      activeTimeout = timeout
      try {
        await postServerCommandJson('/api/login', { token: trimmed }, decodeWith(OkResponseSchema), {
          signal: timeout.signal,
        })
        onSuccess()
      } catch (caught) {
        error.value = caught instanceof Error ? caught.message : t('auth.gate.error-failed')
      } finally {
        timeout.dispose()
        if (activeTimeout === timeout) activeTimeout = null
        submitting.value = false
      }
    }

    onScopeDispose(() => {
      activeTimeout?.abort(new Error('login cancelled'))
      activeTimeout?.dispose()
      activeTimeout = null
    })

    return () => (
      <div class="flex h-full items-center justify-center bg-background p-4">
        <form
          class="flex w-full max-w-sm flex-col gap-3 rounded-md border border-border bg-card p-6 text-card-foreground shadow-sm"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <h1 class="text-lg font-semibold">{t('auth.gate.title')}</h1>
          <p class="text-sm text-muted-foreground">{t('auth.gate.description')}</p>
          <label class="flex flex-col gap-1">
            <span class="text-sm font-medium">{t('auth.gate.token-label')}</span>
            <input
              name="token"
              type="text"
              inputmode="text"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              spellcheck={false}
              value={value.value}
              onInput={(event) => {
                if (event.currentTarget instanceof HTMLInputElement) value.value = event.currentTarget.value
              }}
              disabled={submitting.value}
              class="rounded-md border border-input bg-background px-3 py-2 font-mono text-base"
              placeholder={t('auth.gate.token-placeholder')}
            />
          </label>
          {error.value ? <p class="text-sm text-destructive">{error.value}</p> : null}
          <button
            type="submit"
            disabled={submitting.value}
            class="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {submitting.value ? t('auth.gate.signing-in') : t('auth.gate.sign-in')}
          </button>
        </form>
      </div>
    )
  },
})
