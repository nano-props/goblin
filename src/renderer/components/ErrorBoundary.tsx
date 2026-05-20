// React error boundary for the active-repo body. Without this, a render
// crash inside any tab (BranchList / LogList / StatusList / commit
// detail) would unmount the whole shell and show a blank window.
//
// We re-mount on `resetKey` change — App.tsx passes the active repoId
// as the key, so navigating to a different repo clears any prior crash
// without the user having to restart the app.

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useI18nStore } from '#/renderer/stores/i18n.ts'

interface Props {
  /** When this prop changes (e.g. activeRepoId), state is reset. */
  resetKey?: string | null
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidUpdate(prevProps: Props): void {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Log to console — packaged builds don't ship a remote error sink, so
    // the next-best signal is the local devtools.
    console.error('[gbl] render crash', error, info.componentStack)
  }

  handleRetry = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    // ErrorBoundary is a class so we read the dict directly from the
    // store rather than via the `useT` hook.
    const dict = useI18nStore.getState().dict
    const tx = (k: string) => dict[k] ?? k
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger-surface text-danger">
            <AlertTriangle size={22} />
          </div>
          <div className="text-sm font-semibold text-foreground mb-1">{tx('error.render-crash-title')}</div>
          <div className="text-xs text-muted-foreground mb-4 leading-relaxed">
            {this.state.error.message || tx('error.render-crash-unknown')}
          </div>
          <button
            type="button"
            onClick={this.handleRetry}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs text-foreground cursor-pointer hover:text-foreground hover:bg-muted shadow-sm transition-colors duration-100"
          >
            <RefreshCw size={12} />
            {tx('error.try-again')}
          </button>
        </div>
      </div>
    )
  }
}
