import { Send, Square } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/web/components/ui/button.tsx'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { cn } from '#/web/lib/cn.ts'
import { useT } from '#/web/stores/i18n.ts'
import { sendAgentMessageAndUpdate, useAgentSessionDetailQuery } from '#/web/agent-queries.ts'
import type { AgentSessionBase } from '#/shared/agent-types.ts'
import type { WorkspacePanePanelLabel } from '#/web/components/workspace-pane/tab-providers.ts'

interface AgentChatPanelProps {
  workspacePaneId: string
  panelLabel: WorkspacePanePanelLabel
  base: AgentSessionBase
  agentSessionId: string
}

export function AgentChatPanel({ workspacePaneId, panelLabel, base, agentSessionId }: AgentChatPanelProps) {
  const t = useT()
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const query = useAgentSessionDetailQuery({
    repoRoot: base.repoRoot,
    repoInstanceId: base.repoInstanceId,
    agentSessionId,
  })
  const messages = query.data?.messages ?? []
  const canSend = draft.trim().length > 0 && !sending
  const statusLabelKey = query.data?.phase === 'running' || sending ? 'agent.running' : 'agent.ready'

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, sending])

  const placeholder = useMemo(() => t('agent.input-placeholder'), [t])

  const submit = async () => {
    if (!canSend) return
    const content = draft.trim()
    setDraft('')
    setSending(true)
    try {
      const ok = await sendAgentMessageAndUpdate({
        repoRoot: base.repoRoot,
        repoInstanceId: base.repoInstanceId,
        agentSessionId,
        content,
      })
      if (!ok) toast.error(t('agent.send-failed'))
    } catch (err) {
      toast.error(t('agent.send-failed'), { description: err instanceof Error ? err.message : String(err) })
    } finally {
      setSending(false)
    }
  }

  return (
    <section
      id={`${workspacePaneId}-agent-panel`}
      role="tabpanel"
      aria-labelledby={panelLabel.labelledById}
      aria-label={panelLabel.label}
      className="flex min-h-0 flex-1 flex-col bg-background"
    >
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-separator px-3">
        <div className="min-w-0 truncate text-xs font-medium text-muted-foreground">
          {query.data?.title ?? t('tab.agent')}
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span
            className={cn(
              'size-1.5 rounded-full',
              query.data?.phase === 'error' ? 'bg-danger' : sending ? 'bg-warning' : 'bg-success',
            )}
            aria-hidden="true"
          />
          <span>{t(statusLabelKey)}</span>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1" scrollbarMode="compact">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-4">
          {messages.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">{t('agent.empty')}</div>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  'flex w-full',
                  message.role === 'user' ? 'justify-end' : 'justify-start',
                )}
              >
                <div
                  className={cn(
                    'max-w-[78%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm leading-6 shadow-xs',
                    message.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : message.status === 'error'
                        ? 'border border-danger-border bg-danger-surface text-danger'
                        : 'border border-border bg-control text-foreground',
                  )}
                >
                  {message.content}
                </div>
              </div>
            ))
          )}
          {sending && (
            <div className="flex justify-start">
              <div className="rounded-lg border border-border bg-control px-3 py-2 text-sm text-muted-foreground">
                {t('agent.thinking')}
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
      <form
        className="shrink-0 border-t border-separator bg-background p-3"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                void submit()
              }
            }}
            placeholder={placeholder}
            className="min-h-11 max-h-36 min-w-0 flex-1 resize-none rounded-md border border-input bg-control px-3 py-2 text-sm leading-5 outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
            disabled={sending}
            aria-label={t('agent.input-label')}
          />
          <Button type="submit" size="icon-lg" disabled={!canSend} aria-label={t('agent.send')}>
            {sending ? <Square size={15} /> : <Send size={15} />}
          </Button>
        </div>
      </form>
    </section>
  )
}
