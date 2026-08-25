import type { GitBackgroundSyncTarget } from '#/shared/git-background-sync.ts'
import { subscribeServerCommandTransportReset } from '#/web/lib/server-command-transport.ts'
import { goblinLog } from '#/web/logger.ts'
import { setBackgroundSyncRepos } from '#/web/repos/client.ts'

interface BackgroundSyncRegistrationOwner {
  setTargets: (targets: GitBackgroundSyncTarget[]) => void
  dispose: () => void
}

let activeOwner: object | null = null
let desiredTargets: GitBackgroundSyncTarget[] = []
let mayHaveDeclaredTarget = false
let registrationController: AbortController | null = null

function declareDesiredTargets(): void {
  registrationController?.abort('background-sync-registration-superseded')
  const controller = new AbortController()
  registrationController = controller
  const targets = desiredTargets
  if (targets.length > 0) mayHaveDeclaredTarget = true
  void setBackgroundSyncRepos(targets, controller.signal)
    .then(() => {
      if (registrationController !== controller) return
      if (targets.length === 0) mayHaveDeclaredTarget = false
    })
    .catch((err: unknown) => {
      if (registrationController !== controller) return
      if (!controller.signal.aborted) goblinLog.warn('background sync registration failed', { err })
    })
}

// This registration owner is scoped to the browser page, matching the
// page-scoped clientId used by the server protocol. It intentionally outlives
// the conditional Vue owner so an empty declaration that loses its response
// during transport recovery can still be rehydrated after that scope unmounts.
subscribeServerCommandTransportReset(() => {
  if (desiredTargets.length === 0 && !mayHaveDeclaredTarget) return
  declareDesiredTargets()
})

export function createBackgroundSyncRegistrationOwner(): BackgroundSyncRegistrationOwner {
  const owner = {}
  // Vue can mount a replacement owner before disposing the previous scope.
  // The latest lease is decisive: a late callback or dispose from the stale
  // scope must not overwrite or clear the replacement's complete declaration.
  activeOwner = owner
  return {
    setTargets(targets) {
      if (activeOwner !== owner) return
      desiredTargets = targets
      if (desiredTargets.length === 0 && !mayHaveDeclaredTarget) return
      declareDesiredTargets()
    },
    dispose() {
      if (activeOwner !== owner) return
      activeOwner = null
      desiredTargets = []
      if (!mayHaveDeclaredTarget) {
        registrationController?.abort('background-sync-owner-disposed')
        registrationController = null
        return
      }
      declareDesiredTargets()
    },
  }
}
